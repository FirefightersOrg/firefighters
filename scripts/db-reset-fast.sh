#!/usr/bin/env bash
# Fast reset of the local Supabase database: `supabase db reset` + `seed:admin` take ~40 s, so after
# the first run the migrated and seeded database is snapshotted as a Postgres template database and
# later resets just re-create `postgres` from it.
#
# Usage: scripts/db-reset-fast.sh   (normally through `pnpm db:reset:fast`, which takes the DB lock)
#
# The snapshot is keyed by a hash of everything that shapes the database: supabase/migrations/*,
# supabase/seed.sql, supabase/config.toml and the seed-admin inputs. The hash is stored as the
# COMMENT of the template database, so it lives and dies with the stack's own data volume. When the
# hash differs (or there is no template) the script falls back to a full `supabase db reset` +
# `seed:admin` and takes a new snapshot. The result is the same as `db reset` followed by
# `APP_ENV=local pnpm seed:admin`: a migrated database with the seeded users and nothing else.
#
# Restore = ALLOW_CONNECTIONS false on `postgres`, terminate its sessions (auth, storage, PostgREST,
# realtime, pg_cron and pg_net reconnect by themselves), DROP, CREATE ... TEMPLATE, then re-apply what
# a template does not carry (database-level settings such as app.settings.jwt_secret, and the
# database ACL), then `NOTIFY pgrst, 'reload schema'`.
#
# Env (nothing assumes a single stack; defaults are today's single local instance):
#   SUPABASE_PROJECT_ID     project_id of the target stack (default: from supabase/config.toml)
#   SUPABASE_DB_CONTAINER   DB container (default: supabase_db_<project_id>)
#   SUPABASE_BIN            Supabase CLI (default: supabase)
#   SUPABASE_RESET_ARGS     extra args for `db reset` (e.g. --workdir of another stack)
#   DB_TEMPLATE_NAME        template database name (default: ff_template_<project_id>, per instance)
#   DB_RESET_FAST_REBUILD=1 ignore the existing template and rebuild it
#   API_URL / ANON_KEY / SERVICE_ROLE_KEY  exported per stack, used for the post-restore health check
#                           and by seed:admin when set (as PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)
# This script does not take the DB lock itself: run it through `pnpm db:reset:fast`.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
project_id=${SUPABASE_PROJECT_ID:-$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' supabase/config.toml | head -1)}
container=${SUPABASE_DB_CONTAINER:-supabase_db_$project_id}
supabase_bin=${SUPABASE_BIN:-supabase}
template=${DB_TEMPLATE_NAME:-ff_template_$project_id}
start=$(date +%s)

# Superuser psql inside the DB container: no host psql needed.
sql() { # sql <database> [psql args...]
	local db=$1
	shift
	docker exec -i "$container" psql -U supabase_admin -d "$db" -v ON_ERROR_STOP=1 -qAt "$@"
}

# Hash of every input that shapes the migrated + seeded database.
compute_hash() {
	local f
	{
		for f in supabase/migrations/* supabase/seed.sql supabase/config.toml scripts/seed-admin.ts \
			src/lib/server/services/user-admin.ts; do
			[ -f "$f" ] && { echo "== $f"; cat "$f"; }
		done
		echo "== seed env: ${INITIAL_ADMIN_EMAIL:-} ${INITIAL_ADMIN_NAME:-} ${APP_ENV:-local}"
	} | shasum -a 256 | cut -c1-24
}

# Kick every session off `postgres` and keep new ones out until `allow_conn` is turned back on.
close_database() { # close_database <db>
	sql template1 -c "alter database \"$1\" with allow_connections false" \
		-c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$1' and pid <> pg_backend_pid()" >/dev/null
	# pg_cron / pg_net workers can slip in between: retry until nothing is left.
	local i
	for i in 1 2 3 4 5 6 7 8 9 10; do
		[ "$(sql template1 -c "select count(*) from pg_stat_activity where datname = '$1'")" = "0" ] && return 0
		sql template1 -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$1'" >/dev/null
		sleep 0.5
	done
	echo "db-reset-fast: sessions still connected to $1" >&2
	return 1
}

full_reset_and_snapshot() {
	echo "db-reset-fast: full reset (supabase db reset + seed:admin), then snapshot as $template"
	# shellcheck disable=SC2086
	"$supabase_bin" db reset ${SUPABASE_RESET_ARGS:-}
	# PostgREST needs a moment to load its schema cache after the restart; retry the seed meanwhile.
	local try
	for try in 1 2 3 4 5 6 7 8; do
		if env APP_ENV="${APP_ENV:-local}" ${API_URL:+PUBLIC_SUPABASE_URL=$API_URL} \
			${SERVICE_ROLE_KEY:+SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY} pnpm exec tsx scripts/seed-admin.ts; then
			break
		fi
		[ "$try" = "8" ] && return 1
		echo "db-reset-fast: seed not ready (attempt $try), retrying" >&2
		sleep 3
	done
	snapshot
}

snapshot() {
	if [ "$(sql template1 -c "select count(*) from pg_database where datname = '$template'")" = "1" ]; then
		sql template1 -c "alter database \"$template\" with is_template false" -c "drop database \"$template\""
	fi
	close_database postgres
	sql template1 -c "create database \"$template\" template postgres is_template true allow_connections false" \
		-c "comment on database \"$template\" is '$hash'" \
		-c "alter database postgres with allow_connections true"
	echo "db-reset-fast: snapshot $template saved (hash $hash)"
}

restore() {
	# What a template does not carry over: database-level settings and the database ACL.
	local settings acl
	settings=$(sql template1 -c "select format('alter database postgres set %I to %L', split_part(c, '=', 1), substr(c, position('=' in c) + 1))
		from pg_db_role_setting s join pg_database d on d.oid = s.setdatabase, unnest(s.setconfig) c
		where d.datname = 'postgres' and s.setrole = 0")
	acl=$(sql template1 -c "select format('grant %s on database postgres to %s', string_agg(privilege_type, ', '),
		case grantee when 0 then 'public' else quote_ident(grantee::regrole::text) end)
		from pg_database d, aclexplode(d.datacl) where d.datname = 'postgres' group by grantee")
	if [ -z "$settings" ] || [ -z "$acl" ]; then
		echo "db-reset-fast: cannot read the settings/ACL of postgres" >&2
		return 1
	fi
	# `set -e` is off inside a function called with `||`, so every step reports its own failure.
	close_database postgres || return 1
	sql template1 -c 'drop database postgres' \
		-c "create database postgres template \"$template\" owner postgres" \
		-c 'revoke all on database postgres from public' >/dev/null || return 1
	{ echo "$settings"; echo "$acl"; } | sed 's/$/;/' | sql template1 || return 1
	sql postgres -c "notify pgrst, 'reload schema'" >/dev/null || return 1
	echo "db-reset-fast: restored postgres from $template in $(($(date +%s) - start))s"
}

wait_healthy() {
	[ -n "${API_URL:-}" ] || return 0
	local i
	for i in $(seq 1 60); do
		if curl -fsS -o /dev/null "$API_URL/auth/v1/health" -H "apikey: ${ANON_KEY:-}" &&
			curl -fsS -o /dev/null "$API_URL/rest/v1/" -H "apikey: ${ANON_KEY:-}"; then
			return 0
		fi
		sleep 1
	done
	echo "db-reset-fast: auth/rest did not become healthy" >&2
	return 1
}

hash=$(compute_hash)
stored=$(sql template1 -c "select coalesce(shobj_description(oid, 'pg_database'), '') from pg_database where datname = '$template'" 2>/dev/null || true)

if [ "${DB_RESET_FAST_REBUILD:-}" != "1" ] && [ "$stored" = "$hash" ]; then
	restore || { echo "db-reset-fast: restore failed, falling back to a full reset" >&2; full_reset_and_snapshot; }
else
	[ -n "$stored" ] && echo "db-reset-fast: inputs changed (template $stored, now $hash)"
	full_reset_and_snapshot
fi
wait_healthy
echo "db-reset-fast: done in $(($(date +%s) - start))s"

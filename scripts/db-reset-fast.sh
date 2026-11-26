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
# Env, as exported by scripts/with-db-lock.sh for the slot it took (defaults = the single legacy stack):
#   SUPABASE_PROJECT_ID     project_id of the target stack (default: from supabase/config.toml)
#   SUPABASE_DB_CONTAINER   DB container (default: supabase_db_<project_id>)
#   SUPABASE_WORKDIR        slot workdir, applied to the CLI by scripts/supabase-cli.sh
#   PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY  seed:admin and the health check
# Own knobs:
#   DB_TEMPLATE_NAME        template database name (default: ff_template_<project_id>: one per slot, each
#                           inside its own stack's Postgres, so slots never share or clobber a template)
#   DB_RESET_FAST_REBUILD=1 ignore the existing template and rebuild it
# This script does not take the DB lock itself: run it through `pnpm db:reset:fast`.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
project_id=${SUPABASE_PROJECT_ID:-$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' supabase/config.toml | head -1)}
container=${SUPABASE_DB_CONTAINER:-supabase_db_$project_id}
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
	"$root/scripts/supabase-cli.sh" db reset
	# PostgREST needs a moment to load its schema cache after the restart; retry the seed meanwhile.
	local try
	for try in 1 2 3 4 5 6 7 8; do
		if env APP_ENV="${APP_ENV:-local}" pnpm exec tsx scripts/seed-admin.ts; then
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

# After a restore the services reconnect on their own, with a backoff. Starting a test run before they
# are back makes it slow and flaky, so probe the slot's HTTP API until PostgREST serves a real query
# through its (reloaded) schema cache and auth answers a request that touches the database, twice in a row.
# `/auth/v1/health` does not query the database, so it cannot see the dead pooled connection GoTrue keeps
# after `pg_terminate_backend` (the first sign-in would then fail with 500 "Database error querying schema").
# `GET /auth/v1/admin/users?per_page=1` with the service role reads auth.users, needs no seeded data (an
# empty list is a 200) and burns that stale connection. If auth still fails after 20 probes, restart its
# container (once) and keep probing: slower, but deterministic.
wait_healthy() {
	local url=${PUBLIC_SUPABASE_URL:-} key=${SUPABASE_SERVICE_ROLE_KEY:-${PUBLIC_SUPABASE_ANON_KEY:-}} i ok=0 restarted=0
	[ -n "$url" ] || return 0
	for i in $(seq 1 120); do
		if curl -fsS -o /dev/null "$url/auth/v1/health" -H "apikey: $key" &&
			curl -fsS -o /dev/null "$url/auth/v1/admin/users?per_page=1" -H "apikey: $key" -H "Authorization: Bearer $key" &&
			curl -fsS -o /dev/null "$url/rest/v1/roles?select=id&limit=1" -H "apikey: $key" -H "Authorization: Bearer $key"; then
			ok=$((ok + 1))
			[ "$ok" -ge 2 ] && return 0
		else
			ok=0
			if [ "$i" -ge 20 ] && [ "$restarted" = "0" ]; then
				restarted=1
				echo "db-reset-fast: auth still failing after $i probes, restarting supabase_auth_$project_id" >&2
				docker restart "supabase_auth_$project_id" >/dev/null || true
			fi
		fi
		sleep 1
	done
	echo "db-reset-fast: auth/PostgREST did not answer on $url" >&2
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

#!/usr/bin/env bash
# Waits until the local Supabase stack serves requests after a database reset, so what runs next
# (`seed:admin`, tests) never races PostgREST's schema cache or GoTrue's stale connection.
#
# Usage: scripts/db-wait-ready.sh [--no-notify]
# Used by scripts/db-reset.sh (full reset) and scripts/db-reset-fast.sh (fast reset).
#
# 1. `NOTIFY pgrst, 'reload schema'` (unless --no-notify), so PostgREST reloads its schema cache now.
# 2. Probes the slot's HTTP API until, twice in a row: auth `/health` answers, `GET /auth/v1/admin/users`
#    (service role) reads auth.users, and PostgREST serves `GET /rest/v1/roles` and `/profiles` (migrated
#    tables: a stale schema cache shows up as 404 PGRST205 instead of 200).
#    `/auth/v1/health` does not query the database, so it cannot see the dead pooled connection GoTrue
#    keeps after `pg_terminate_backend` (the first sign-in would fail with 500 "Database error querying
#    schema"); the admin users call burns that connection. If auth still fails after 20 probes while
#    PostgREST is fine, the auth container is restarted once and probing continues.
# 3. Bounded: DB_WAIT_READY_SECONDS probes (default 120, one per second), then exit 1 with a clear error.
#
# Env (as exported by scripts/with-db-lock.sh; .env is read when the URL is not set):
#   PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or PUBLIC_SUPABASE_ANON_KEY),
#   SUPABASE_PROJECT_ID, SUPABASE_DB_CONTAINER
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
notify=1
[ "${1:-}" = "--no-notify" ] && notify=0

if [ -z "${PUBLIC_SUPABASE_URL:-}" ] && [ -f .env ]; then
	set -a
	# shellcheck disable=SC1091
	. ./.env
	set +a
fi
url=${PUBLIC_SUPABASE_URL:-}
key=${SUPABASE_SERVICE_ROLE_KEY:-${PUBLIC_SUPABASE_ANON_KEY:-}}
project_id=${SUPABASE_PROJECT_ID:-$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' supabase/config.toml | head -1)}
container=${SUPABASE_DB_CONTAINER:-supabase_db_$project_id}
tag="db-wait-ready"
if [ -z "$url" ]; then
	echo "$tag: PUBLIC_SUPABASE_URL is not set, nothing to probe" >&2
	exit 0
fi

if [ "$notify" = "1" ]; then
	docker exec -i "$container" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -qAt \
		-c "notify pgrst, 'reload schema'" >/dev/null ||
		echo "$tag: could not NOTIFY pgrst (continuing with the probes)" >&2
fi

rest_status() { # rest_status <table>: HTTP status of a PostgREST read with the service key
	curl -s -o /dev/null -w '%{http_code}' "$url/rest/v1/$1?select=id&limit=1" \
		-H "apikey: $key" -H "Authorization: Bearer $key" || true
}

limit=${DB_WAIT_READY_SECONDS:-120}
ok=0
restarted=0
last=""
for i in $(seq 1 "$limit"); do
	roles=$(rest_status roles)
	profiles=$(rest_status profiles)
	rest_ok=0
	[ "$roles" = "200" ] && [ "$profiles" = "200" ] && rest_ok=1
	if [ "$rest_ok" = "1" ] &&
		curl -fsS -o /dev/null "$url/auth/v1/health" -H "apikey: $key" 2>/dev/null &&
		curl -fsS -o /dev/null "$url/auth/v1/admin/users?per_page=1" -H "apikey: $key" -H "Authorization: Bearer $key" 2>/dev/null; then
		ok=$((ok + 1))
		[ "$ok" -ge 2 ] && exit 0
	else
		ok=0
		last="rest roles=$roles profiles=$profiles"
		if [ "$i" -ge 20 ] && [ "$restarted" = "0" ] && [ "$rest_ok" = "1" ]; then
			restarted=1
			echo "$tag: auth still failing after $i probes, restarting supabase_auth_$project_id" >&2
			docker restart "supabase_auth_$project_id" >/dev/null || true
		fi
	fi
	sleep 1
done
echo "$tag: auth/PostgREST did not become ready on $url within ${limit}s (last: ${last:-auth not answering})" >&2
exit 1

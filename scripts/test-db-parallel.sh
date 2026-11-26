#!/usr/bin/env bash
# Runs the pgTAP suite (supabase/tests/database) with several `pg_prove` jobs at once.
#
# `supabase test db` runs the files one after another. Almost every file is one rolled-back
# transaction (`begin; ... finish(); rollback;`), so they can share the database in parallel.
# Two kinds of file are NOT safe next to others and run serially AFTER the parallel batch, one at a
# time: (1) dblink files, which open real extra sessions, commit fixtures and wait on row locks;
# (2) files that take table-level locks inside their transaction (TRUNCATE, ALTER TABLE,
# ENABLE/DISABLE TRIGGER, DROP/CREATE TRIGGER|POLICY|INDEX|TABLE|FUNCTION), which deadlock with
# concurrent inserts into the same tables. A file can also opt out with a `-- pgtap: serial` line.
#
# Usage: scripts/test-db-parallel.sh   (normally through `pnpm db:test:parallel`)
#
# Env:
#   PGTAP_JOBS      parallel jobs (default: CPU count)
#   PG_PROVE        pg_prove binary to use instead of the Supabase CLI image
#   PGTAP_IMAGE     pg_prove image (default: the one the Supabase CLI uses, public.ecr.aws/supabase/pg_prove:3.36)
#   SUPABASE_DB_CONTAINER  DB container (default: supabase_db_<project_id>)
#   SUPABASE_DB_NETWORK    docker network (default: supabase_network_<project_id>)
#   SUPABASE_PROJECT_ID    Supabase project_id of the target stack (default: from supabase/config.toml)
#   SUPABASE_DB_HOST/SUPABASE_DB_PORT/SUPABASE_DB_PASSWORD  used with PG_PROVE (default 127.0.0.1, 54322, postgres)
# Nothing assumes a single stack: a pool of stacks only needs to export these per slot.
#
# Requirement: the local Supabase stack is running, plus either Docker (the pg_prove image is already
# pulled by `supabase test db`) or a local `pg_prove` (set PG_PROVE; it connects to 127.0.0.1:54322).
# This script does not take the DB lock itself: run it through `pnpm db:test:parallel`, which does.
set -u

root=$(cd "$(dirname "$0")/.." && pwd)
tests_dir="$root/supabase/tests/database"
project_id=${SUPABASE_PROJECT_ID:-$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' "$root/supabase/config.toml" | head -1)}
container=${SUPABASE_DB_CONTAINER:-supabase_db_$project_id}
network=${SUPABASE_DB_NETWORK:-supabase_network_$project_id}
image=${PGTAP_IMAGE:-public.ecr.aws/supabase/pg_prove:3.36}
jobs=${PGTAP_JOBS:-$( (sysctl -n hw.ncpu || nproc) 2>/dev/null || echo 4)}

serial_pattern='dblink|-- pgtap: serial|truncate|alter table|(en|dis)able trigger|drop (table|trigger|function|policy|index)|create (or replace )?(trigger|policy|index)'
serial=() parallel=()
for f in "$tests_dir"/*.sql; do
	if grep -qiE "$serial_pattern" "$f"; then serial+=("$f"); else parallel+=("$f"); fi
done

# pg_prove runs inside the container image, with the test files mounted read-only.
prove() { # prove <jobs> <files...>
	local j=$1
	shift
	if [ -n "${PG_PROVE:-}" ]; then
		PGPASSWORD=${SUPABASE_DB_PASSWORD:-postgres} "$PG_PROVE" -h "${SUPABASE_DB_HOST:-127.0.0.1}" -p "${SUPABASE_DB_PORT:-54322}" -U postgres -d postgres --jobs "$j" "$@"
	else
		local args=() f
		for f in "$@"; do args+=("/tests/$(basename "$f")"); done
		docker run --rm --network "$network" -v "$tests_dir:/tests:ro" -e PGPASSWORD="${SUPABASE_DB_PASSWORD:-postgres}" \
			"$image" pg_prove -h "$container" -p 5432 -U postgres -d postgres --jobs "$j" "${args[@]}"
	fi
}

# Same preparation as `supabase test db`.
docker exec "$container" psql -U postgres -d postgres -q \
	-c 'create extension if not exists pgtap with schema extensions' >/dev/null || {
	echo "test-db-parallel: cannot reach $container (is local Supabase running?)" >&2
	exit 2
}

start=$(date +%s)
echo "pgTAP: ${#parallel[@]} files in parallel (jobs=$jobs), then ${#serial[@]} lock-taking/dblink files serially"
prove "$jobs" "${parallel[@]}"
status=$?
prove 1 "${serial[@]}"
serial_status=$?
echo "pgTAP total: $(($(date +%s) - start))s"
[ "$status" -eq 0 ] && [ "$serial_status" -eq 0 ]

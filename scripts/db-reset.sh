#!/usr/bin/env bash
# Full local database reset: `supabase db reset`, then wait until PostgREST has reloaded its schema
# cache and auth answers (scripts/db-wait-ready.sh), so a `seed:admin` right after never hits
# PGRST205 "Could not find the table 'public.profiles' in the schema cache".
# Usage: scripts/db-reset.sh   (normally through `pnpm db:reset`, which takes the DB lock)
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
"$root/scripts/supabase-cli.sh" db reset "$@"
"$root/scripts/db-wait-ready.sh"

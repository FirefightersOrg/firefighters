#!/usr/bin/env bash
# Stops the stacks of the pool slots (SAN-165; data volumes are kept).
# Usage: scripts/slots-stop.sh [slot...]   (default: 1..DB_SLOTS)
# Skips slots whose lock is held by a live process, so it never pulls a stack from under a run.
set -u
root=$(cd "$(dirname "$0")/.." && pwd)
common_dir=$(git rev-parse --path-format=absolute --git-common-dir)
slots=${*:-$(seq 1 "${DB_SLOTS:-3}")}
for s in $slots; do
	lock="$common_dir/supabase-db-slot-$s.lock"
	if [ -d "$lock" ] && kill -0 "$(cat "$lock/pid" 2>/dev/null)" 2>/dev/null; then
		echo "slot $s is in use, skipping"
		continue
	fi
	"${SUPABASE_BIN:-supabase}" stop --workdir "$("$root/scripts/supabase-slot-config.sh" "$s")" || true
done

#!/usr/bin/env bash
# Serializes use of the single local Supabase stack across every worktree/agent on this machine.
#
# Usage: scripts/with-db-lock.sh <command> [args...]
#
# The local Supabase (one DB, one auth service, shared seeded users) cannot take two test runs or
# a `db reset` at once: concurrent runs fight over users/permissions and starve auth, which shows
# up as "Could not load the permissions", PGRST303 and "Hook timed out" failures. The lock lives in
# the git common dir, so all worktrees of this repo share it.
#
# Portable `mkdir` lock (macOS has no `flock`). A lock is stale when its owner pid is gone or it is
# older than DB_LOCK_STALE_SECONDS (default 3600). DB_LOCK_WAIT_SECONDS bounds the wait (default
# 3600; 0 = forever).
set -u

if [ "$#" -eq 0 ]; then
	echo "usage: $0 <command> [args...]" >&2
	exit 2
fi

# Nested call from a command that already holds the lock.
if [ "${SUPABASE_DB_LOCK_HELD:-}" = "1" ]; then
	exec "$@"
fi

common_dir=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || {
	echo "with-db-lock: not inside a git repository" >&2
	exit 2
}
lock_dir="$common_dir/supabase-db.lock"
stale_after=${DB_LOCK_STALE_SECONDS:-3600}
max_wait=${DB_LOCK_WAIT_SECONDS:-3600}

owner_pid() { cat "$lock_dir/pid" 2>/dev/null; }

lock_is_stale() {
	local pid started now
	pid=$(owner_pid)
	if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
		return 0
	fi
	started=$(cat "$lock_dir/started" 2>/dev/null || echo 0)
	now=$(date +%s)
	[ $((now - started)) -ge "$stale_after" ]
}

held=0
cleanup() {
	if [ "$held" = "1" ]; then
		rm -rf "$lock_dir"
		held=0
	fi
}
# On a signal, clean up and exit with the conventional code; the child gets the same signal
# because it shares our process group when run from a terminal.
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM HUP

waited=0
announced=0
until mkdir "$lock_dir" 2>/dev/null; do
	if lock_is_stale; then
		echo "with-db-lock: removing stale lock (owner pid $(owner_pid))" >&2
		rm -rf "$lock_dir"
		continue
	fi
	if [ "$announced" = "0" ]; then
		echo "waiting for local Supabase lock… (held by pid $(owner_pid), $lock_dir)" >&2
		announced=1
	fi
	if [ "$max_wait" -gt 0 ] && [ "$waited" -ge "$max_wait" ]; then
		echo "with-db-lock: gave up after ${waited}s waiting for the lock" >&2
		exit 1
	fi
	sleep 2
	waited=$((waited + 2))
done
held=1
echo $$ >"$lock_dir/pid"
date +%s >"$lock_dir/started"
[ "$announced" = "1" ] && echo "local Supabase lock acquired after ${waited}s" >&2

# Not `exec`: the trap must run afterwards to release the lock.
SUPABASE_DB_LOCK_HELD=1 "$@"
status=$?
exit "$status"

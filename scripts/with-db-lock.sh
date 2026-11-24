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
# Portable `mkdir` lock (macOS has no `flock`). A lock is stale only when its owner pid is gone, or
# when it has no pid and is older than DB_LOCK_STALE_SECONDS (default 3600). A live owner is never
# displaced. DB_LOCK_WAIT_SECONDS bounds the wait (default
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

# mtime of the lock dir (BSD stat on macOS, GNU stat on Linux).
lock_mtime() { stat -f %m "$lock_dir" 2>/dev/null || stat -c %Y "$lock_dir" 2>/dev/null || echo 0; }

# A lock is stale only when its owner is provably gone: the pid file names a dead process, or the
# lock never got a pid (the owner died between `mkdir` and writing it) and is older than the
# threshold. A live owner is never displaced, however long it runs, so two commands can never hold
# the lock at once (a wedged holder is bounded by DB_LOCK_WAIT_SECONDS on the waiters instead).
lock_is_stale() {
	local pid started now
	pid=$(owner_pid)
	if [ -n "$pid" ]; then
		! kill -0 "$pid" 2>/dev/null
		return
	fi
	started=$(lock_mtime)
	now=$(date +%s)
	[ $((now - started)) -ge "$stale_after" ]
}

# Removes a lock judged stale. The lock is first renamed (atomic) so a lock that another waiter
# re-created in the meantime is only deleted if it is still the one we judged stale.
remove_stale_lock() {
	local seen_pid=$1 trash="$lock_dir.stale.$$"
	mv "$lock_dir" "$trash" 2>/dev/null || return 0
	if [ "$(cat "$trash/pid" 2>/dev/null)" = "$seen_pid" ]; then
		rm -rf "$trash"
	else
		# Someone replaced the lock between the check and the rename: put it back if still free.
		mv -n "$trash" "$lock_dir" 2>/dev/null || rm -rf "$trash"
	fi
}

held=0
token="$$.$RANDOM$RANDOM.$(date +%s)"
cleanup() {
	if [ "$held" = "1" ]; then
		held=0
		# Release only a lock that is still ours: never delete a successor's lock.
		if [ "$(cat "$lock_dir/token" 2>/dev/null)" = "$token" ]; then
			rm -rf "$lock_dir"
		fi
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
		stale_pid=$(owner_pid)
		echo "with-db-lock: removing stale lock (owner pid ${stale_pid:-unknown})" >&2
		remove_stale_lock "$stale_pid"
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
echo "$token" >"$lock_dir/token"
echo $$ >"$lock_dir/pid"
date +%s >"$lock_dir/started"
[ "$announced" = "1" ] && echo "local Supabase lock acquired after ${waited}s" >&2

# Not `exec`: the trap must run afterwards to release the lock.
SUPABASE_DB_LOCK_HELD=1 "$@"
status=$?
exit "$status"

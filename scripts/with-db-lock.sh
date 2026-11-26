#!/usr/bin/env bash
# Runs a command against one local Supabase stack of a small pool ("slots"), taking the slot's lock.
#
# Usage: scripts/with-db-lock.sh <command> [args...]
#
# One local Supabase (one DB, one auth service, shared seeded users) cannot take two test runs or a
# `db reset` at once: concurrent runs fight over users/permissions and starve auth, which shows up
# as "Could not load the permissions", PGRST303 and "Hook timed out" failures. So every agent takes
# a whole stack for its command, and up to DB_SLOTS agents (default 3) run in parallel, each on its
# own stack: project_id firefighters-N, its own ports, trimmed services (see
# scripts/supabase-slot-config.sh). The locks live in the git common dir, so all worktrees share them.
#
# What the wrapped command gets (slot mode):
#   SUPABASE_SLOT, SUPABASE_PROJECT_ID, SUPABASE_WORKDIR (pass as `--workdir` to the CLI),
#   PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
#   SUPABASE_DB_URL, SUPABASE_DB_HOST/PORT/PASSWORD, SUPABASE_DB_CONTAINER, SUPABASE_DB_NETWORK,
#   E2E_PORT (Playwright dev server, unique per slot).
# The slot's stack is started if it is down. Nothing here resets the DB: that is the caller's job
# (`pnpm db:reset`), so a sequence is `scripts/with-db-lock.sh sh -c 'pnpm db:reset && ...'`.
#
# Env:
#   DB_SLOTS               pool size (default 3). 1 = single-stack mode: the stack from
#                          supabase/config.toml (project_id firefighters, ports 543xx), the single
#                          lock supabase-db.lock, and nothing exported or started: today's behavior.
#   DB_SLOT                pin one slot instead of taking the first free one.
#   DB_LOCK_WAIT_SECONDS   bound on the wait for a free slot (default 3600; 0 = forever).
#   DB_LOCK_STALE_SECONDS  age after which a lock with no pid is stale (default 3600).
#
# Portable `mkdir` lock (macOS has no `flock`). A lock is stale only when its owner pid is gone, or
# when it has no pid and is older than DB_LOCK_STALE_SECONDS. A live owner is never displaced.
# Re-entrant: a nested call from a command that already holds a slot just runs.
set -u

if [ "$#" -eq 0 ]; then
	echo "usage: $0 <command> [args...]" >&2
	exit 2
fi

# Nested call from a command that already holds the lock (and so its slot env).
if [ "${SUPABASE_DB_LOCK_HELD:-}" = "1" ]; then
	exec "$@"
fi

root=$(cd "$(dirname "$0")/.." && pwd)
common_dir=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || {
	echo "with-db-lock: not inside a git repository" >&2
	exit 2
}
slots=${DB_SLOTS:-3}
stale_after=${DB_LOCK_STALE_SECONDS:-3600}
max_wait=${DB_LOCK_WAIT_SECONDS:-3600}
case "$slots" in '' | *[!0-9]* | 0)
	echo "with-db-lock: DB_SLOTS must be a positive integer" >&2
	exit 2
	;;
esac

lock_dir=""
lock_path() { # lock_path <slot>
	if [ "$slots" = "1" ]; then echo "$common_dir/supabase-db.lock"; else echo "$common_dir/supabase-db-slot-$1.lock"; fi
}
owner_pid() { cat "$lock_dir/pid" 2>/dev/null; }

# mtime of the lock dir (BSD stat on macOS, GNU stat on Linux).
lock_mtime() { stat -f %m "$lock_dir" 2>/dev/null || stat -c %Y "$lock_dir" 2>/dev/null || echo 0; }

# A lock is stale only when its owner is provably gone: the pid file names a dead process, or the
# lock never got a pid (the owner died between `mkdir` and writing it) and is older than the
# threshold. A live owner is never displaced, however long it runs (a wedged holder is bounded by
# DB_LOCK_WAIT_SECONDS on the waiters instead).
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

# try_slot <slot>: 0 if we now hold it. A stale lock is removed and retried once.
try_slot() {
	lock_dir=$(lock_path "$1")
	local stale_pid
	if mkdir "$lock_dir" 2>/dev/null; then return 0; fi
	if lock_is_stale; then
		stale_pid=$(owner_pid)
		echo "with-db-lock: removing stale lock of slot $1 (owner pid ${stale_pid:-unknown})" >&2
		remove_stale_lock "$stale_pid"
		mkdir "$lock_dir" 2>/dev/null && return 0
	fi
	return 1
}

slot=""
waited=0
announced=0
while :; do
	if [ -n "${DB_SLOT:-}" ]; then candidates=$DB_SLOT; else candidates=$(seq 1 "$slots"); fi
	for s in $candidates; do
		if try_slot "$s"; then
			slot=$s
			break
		fi
	done
	[ -n "$slot" ] && break
	if [ "$announced" = "0" ]; then
		echo "waiting for a free local Supabase slot (all $slots busy, locks in $common_dir)…" >&2
		announced=1
	fi
	if [ "$max_wait" -gt 0 ] && [ "$waited" -ge "$max_wait" ]; then
		echo "with-db-lock: gave up after ${waited}s waiting for a slot" >&2
		exit 1
	fi
	sleep 2
	waited=$((waited + 2))
done
held=1
echo "$token" >"$lock_dir/token"
echo $$ >"$lock_dir/pid"
date +%s >"$lock_dir/started"
[ "$announced" = "1" ] && echo "local Supabase slot $slot acquired after ${waited}s" >&2

if [ "$slots" != "1" ]; then
	workdir=$("$root/scripts/supabase-slot-config.sh" "$slot") || exit 1
	supabase_bin=${SUPABASE_BIN:-supabase}
	base=$((54300 + 100 * slot))
	export SUPABASE_SLOT=$slot
	export SUPABASE_WORKDIR=$workdir
	export SUPABASE_PROJECT_ID="firefighters-$slot"
	export SUPABASE_DB_CONTAINER="supabase_db_firefighters-$slot"
	export SUPABASE_DB_NETWORK="supabase_network_firefighters-$slot"
	export SUPABASE_DB_HOST=127.0.0.1
	export SUPABASE_DB_PORT=$((base + 22))
	export SUPABASE_DB_PASSWORD=postgres
	export SUPABASE_DB_URL="postgresql://postgres:postgres@127.0.0.1:$((base + 22))/postgres"
	export PUBLIC_SUPABASE_URL="http://127.0.0.1:$((base + 21))"
	export E2E_PORT=$((4317 + slot))

	# Start the slot's stack if it is down.
	if ! "$supabase_bin" status --workdir "$workdir" >/dev/null 2>&1; then
		echo "with-db-lock: starting the stack of slot $slot ($SUPABASE_PROJECT_ID)…" >&2
		"$supabase_bin" start --workdir "$workdir" >&2 || {
			echo "with-db-lock: could not start slot $slot" >&2
			exit 1
		}
	fi
	# The local JWT secret is shared by all stacks, but read the keys from the stack instead of
	# assuming it.
	status_env=$("$supabase_bin" status --workdir "$workdir" -o env 2>/dev/null)
	key() { printf '%s\n' "$status_env" | sed -n "s/^$1=\"\(.*\)\"$/\1/p" | head -1; }
	PUBLIC_SUPABASE_ANON_KEY=$(key ANON_KEY)
	SUPABASE_SERVICE_ROLE_KEY=$(key SERVICE_ROLE_KEY)
	if [ -z "$PUBLIC_SUPABASE_ANON_KEY" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
		echo "with-db-lock: could not read the keys of slot $slot (supabase status -o env)" >&2
		exit 1
	fi
	export PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY
	# Same value for shell and node code: the guard in tests/integration needs APP_ENV=local.
	export APP_ENV=${APP_ENV:-local}
fi

# Not `exec`: the trap must run afterwards to release the lock.
SUPABASE_DB_LOCK_HELD=1 "$@"
status=$?
exit "$status"

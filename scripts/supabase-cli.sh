#!/usr/bin/env bash
# Supabase CLI aimed at the slot stack of the environment (SUPABASE_WORKDIR, set by
# scripts/with-db-lock.sh); without a slot it is the plain CLI on supabase/config.toml.
# Usage: scripts/supabase-cli.sh <supabase args...>   (SUPABASE_BIN overrides the binary)
set -eu
exec "${SUPABASE_BIN:-supabase}" "$@" ${SUPABASE_WORKDIR:+--workdir "$SUPABASE_WORKDIR"}

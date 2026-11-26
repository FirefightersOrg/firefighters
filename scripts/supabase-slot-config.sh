#!/usr/bin/env bash
# Generates the Supabase workdir of one pool slot (SAN-165) from supabase/config.toml.
#
# Usage: scripts/supabase-slot-config.sh <slot>   (prints the slot workdir)
#
# Slot N gets supabase/slots/N/supabase/config.toml: the base config with its own project_id
# (firefighters-N, so containers, network and volumes are separate), its own port block and only the
# services the tests need (db, auth, rest/kong). studio, pg_meta, analytics, vector, realtime, edge
# runtime, inbucket and storage are off (nothing in src/, features/, scripts/ or tests/ uses
# storage, backups included). migrations/, seed.sql and tests/ are symlinks to the shared ones.
# The directory is git-ignored; it is regenerated on every call, so it never drifts from the base.
#
# Port block of slot N (base = 54300 + 100*N, so slot 1 = 544xx, slot 2 = 545xx, ...; the legacy
# single stack keeps 543xx): api base+21, db base+22, shadow db base+20, pooler base+29,
# studio base+23, smtp base+24, analytics base+27, inspector base+83. Playwright dev server: 4317+N.
set -eu

slot=${1:?usage: $0 <slot>}
case "$slot" in '' | *[!0-9]* | 0)
	echo "slot must be a positive integer" >&2
	exit 2
	;;
esac
root=$(cd "$(dirname "$0")/.." && pwd)
base=$((54300 + 100 * slot))
workdir="$root/supabase/slots/$slot"
mkdir -p "$workdir/supabase"
for item in migrations seed.sql tests; do
	ln -sfn "../../../$item" "$workdir/supabase/$item"
done

awk -v slot="$slot" -v base="$base" '
function setkey(k, v) { sub("^" k " *=.*", k " = " v) }
/^project_id *=/ { print "project_id = \"firefighters-" slot "\""; next }
/^\[/ { section = $0 }
{
	if (section == "[api]") { setkey("port", base + 21) }
	if (section == "[db]") { setkey("port", base + 22); setkey("shadow_port", base + 20) }
	if (section == "[db.pooler]") { setkey("port", base + 29) }
	if (section == "[studio]") { setkey("port", base + 23) }
	if (section == "[local_smtp]") { setkey("port", base + 24) }
	if (section == "[analytics]") { setkey("port", base + 27) }
	if (section == "[edge_runtime]") { setkey("inspector_port", base + 83) }
	if (section ~ /^\[(realtime|studio|local_smtp|storage|storage\.s3_protocol|storage\.vector|edge_runtime|analytics)\]$/) { setkey("enabled", "false") }
	print
}' "$root/supabase/config.toml" >"$workdir/supabase/config.toml"
echo "$workdir"

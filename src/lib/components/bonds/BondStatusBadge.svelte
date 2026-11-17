<script lang="ts">
	import { BOND_COMMERCIAL_STATUS_LABELS, type BondCommercialStatus } from '$lib/domain/bonds';

	let { status }: { status: BondCommercialStatus } = $props();

	const TONES: Record<BondCommercialStatus, string> = {
		created: 'bg-slate-100 text-slate-700 ring-slate-300',
		available: 'bg-green-50 text-green-800 ring-green-300',
		delivered_to_collector: 'bg-blue-50 text-blue-800 ring-blue-300',
		sold: 'bg-indigo-50 text-indigo-800 ring-indigo-300',
		returned: 'bg-amber-50 text-amber-800 ring-amber-300',
		lost: 'bg-orange-50 text-orange-800 ring-orange-300',
		annulled: 'bg-red-50 text-red-800 ring-red-300',
		closed: 'bg-slate-100 text-slate-700 ring-slate-300'
	};
</script>

<span
	class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset {TONES[
		status
	]}"
>
	{BOND_COMMERCIAL_STATUS_LABELS[status]}
</span>

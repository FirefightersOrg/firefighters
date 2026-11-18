<script lang="ts">
	import RecordSection from './RecordSection.svelte';
	import type { BondRecordParty } from './types';

	/**
	 * Bond record, 4. "Current collector" / 5. "Current buyer". Collectors and buyers get their
	 * own records in Phase 5 (delivery to collectors in Phase 6, sales in Phase 7); until then the
	 * bond can only show whether one is set.
	 */
	let { role, party }: { role: 'collector' | 'buyer'; party: BondRecordParty } = $props();

	const PHASE_NOTE = {
		collector: 'Collectors arrive in Phase 5 and bonds are delivered to them in Phase 6.',
		buyer: 'Buyers arrive in Phase 5 and are set when the bond is sold (Phase 7).'
	};
</script>

<RecordSection id={role}>
	{#if party.id}
		<p class="text-sm">
			A {role} is recorded for this bond; their details are shown once {role} records exist.
		</p>
	{:else}
		<p class="text-sm text-slate-500">
			{role === 'collector' ? 'Not delivered to a collector.' : 'No buyer: the bond is not sold.'}
		</p>
	{/if}
	<p class="mt-2 text-xs text-slate-500">{PHASE_NOTE[role]}</p>
</RecordSection>

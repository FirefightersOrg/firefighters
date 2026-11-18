<script lang="ts">
	import RecordSection from './RecordSection.svelte';
	import type { BondRecordSectionId } from './types';

	/**
	 * Bond record sections whose data arrives in later phases (6. Sale ... 12. Prizes): an empty
	 * state naming the phase that adds it.
	 */
	type PendingId = Extract<
		BondRecordSectionId,
		'sale' | 'installments' | 'payments' | 'settlements' | 'commissions' | 'draws' | 'prizes'
	>;
	let { id }: { id: PendingId } = $props();

	const STATES: Record<PendingId, { empty: string; phase: string }> = {
		sale: { empty: 'This bond has not been sold.', phase: 'Sales are recorded from Phase 7.' },
		installments: {
			empty: 'No installment plan.',
			phase: 'Installment plans are generated with the sale (Phase 7).'
		},
		payments: { empty: 'No payments recorded.', phase: 'Payments are recorded from Phase 8.' },
		settlements: {
			empty: 'Not included in any settlement.',
			phase: 'Settlements with collectors arrive in Phase 8.'
		},
		commissions: {
			empty: 'No commissions generated.',
			phase: 'Commissions are generated from Phase 9.'
		},
		draws: {
			empty: 'Not included in any draw roster.',
			phase: 'Draws and rosters arrive in Phase 11.'
		},
		prizes: { empty: 'No prizes.', phase: 'Winners and prizes arrive in Phase 12.' }
	};
</script>

<RecordSection {id}>
	<p class="text-sm text-slate-500">{STATES[id].empty}</p>
	<p class="mt-1 text-xs text-slate-500">{STATES[id].phase}</p>
</RecordSection>

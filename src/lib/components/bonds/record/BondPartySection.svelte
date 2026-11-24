<script lang="ts">
	import RecordSection from './RecordSection.svelte';
	import type { BondRecordParty } from './types';

	/**
	 * Bond record, 4. "Cobrador actual" / 6. "Comprador actual". Collectors and buyers get their
	 * own records in Phase 5 (delivery to collectors in Phase 6, sales in Phase 7); until then the
	 * bond can only show whether one is set.
	 */
	let { role, party }: { role: 'collector' | 'buyer'; party: BondRecordParty } = $props();

	const PHASE_NOTE = {
		collector: 'Los cobradores llegan en la fase 5 y los bonos se les entregan en la fase 6.',
		buyer: 'Los compradores llegan en la fase 5 y se asignan al vender el bono (fase 7).'
	};
</script>

<RecordSection id={role}>
	{#if party.id}
		<p class="m-0 text-body-sm">
			Hay {role === 'collector' ? 'un cobrador registrado' : 'un comprador registrado'} para este bono;
			sus datos se muestran cuando existan las fichas de {role === 'collector'
				? 'cobradores'
				: 'compradores'}.
		</p>
	{:else}
		<p class="m-0 text-body-sm text-muted">
			{role === 'collector'
				? 'No se entregó a un cobrador.'
				: 'Sin comprador: el bono no se vendió.'}
		</p>
	{/if}
	<p class="m-0 mt-2 text-caption text-muted">{PHASE_NOTE[role]}</p>
</RecordSection>

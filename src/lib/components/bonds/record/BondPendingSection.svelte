<script lang="ts">
	import RecordSection from './RecordSection.svelte';
	import type { BondRecordSectionId } from './types';

	/**
	 * Bond record sections whose data arrives in later phases (rendiciones, comisiones): an empty
	 * state naming the phase that adds it.
	 */
	type PendingId = Extract<
		BondRecordSectionId,
		'sale' | 'installments' | 'payments' | 'settlements' | 'commissions' | 'draws' | 'prizes'
	>;
	let { id }: { id: PendingId } = $props();

	const STATES: Record<PendingId, { empty: string; phase: string }> = {
		sale: { empty: 'Este bono no se vendió.', phase: 'Las ventas se registran desde la fase 7.' },
		installments: {
			empty: 'Sin plan de cuotas.',
			phase: 'Los planes de cuotas se generan con la venta (fase 7).'
		},
		payments: {
			empty: 'No hay pagos registrados.',
			phase: 'Los pagos se registran desde la fase 8.'
		},
		settlements: {
			empty: 'No figura en ninguna rendición.',
			phase: 'Las rendiciones con cobradores llegan en la fase 8.'
		},
		commissions: {
			empty: 'No se generaron comisiones.',
			phase: 'Las comisiones se generan desde la fase 9.'
		},
		draws: {
			empty: 'No figura en ningún padrón de sorteo.',
			phase: 'Los sorteos y padrones llegan en la fase 11.'
		},
		prizes: { empty: 'Sin premios.', phase: 'Los ganadores y premios llegan en la fase 12.' }
	};
</script>

<RecordSection {id}>
	<p class="m-0 text-body-sm text-muted">{STATES[id].empty}</p>
	<p class="m-0 mt-1 text-caption text-muted">{STATES[id].phase}</p>
</RecordSection>

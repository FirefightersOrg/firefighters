<script lang="ts">
	import RecordSection from './RecordSection.svelte';
	import type { BondRecordBarcode } from './types';

	/** Bond record, 3. "Código de barras": the bond's barcode and internal code, and the campaign's mode. */
	let { barcode }: { barcode: BondRecordBarcode } = $props();
</script>

<RecordSection id="barcode">
	<dl class="m-0 grid grid-cols-1 gap-x-6 gap-y-4 text-body-sm sm:grid-cols-3">
		<div>
			<dt class="text-muted">Código de barras</dt>
			<dd class="m-0 font-mono font-medium">{barcode.barcode ?? '—'}</dd>
		</div>
		<div>
			<dt class="text-muted">Código interno</dt>
			<dd class="m-0 font-mono font-medium">{barcode.internalCode ?? '—'}</dd>
		</div>
		<div>
			<dt class="text-muted">Modo de código de barras de la campaña</dt>
			<dd class="m-0 font-medium">{barcode.modeLabel}</dd>
		</div>
	</dl>
	{#if !barcode.barcode}
		<p class="m-0 mt-3 text-body-sm text-muted">
			No se registró un código de barras para este bono.
		</p>
	{/if}
	<p class="m-0 mt-3 text-caption text-muted">
		La carga y la búsqueda por código de barras escaneado llegan en la fase 4.
	</p>
</RecordSection>

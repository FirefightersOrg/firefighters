<script lang="ts">
	import RecordSection from './RecordSection.svelte';
	import type { BondRecordBarcode } from './types';

	/** Bond record, 3. "Barcode": the bond's barcode and internal code, and the campaign's mode. */
	let { barcode }: { barcode: BondRecordBarcode } = $props();
</script>

<RecordSection id="barcode">
	<dl class="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
		<div>
			<dt class="text-slate-500">Barcode</dt>
			<dd class="font-mono font-medium">{barcode.barcode ?? '—'}</dd>
		</div>
		<div>
			<dt class="text-slate-500">Internal code</dt>
			<dd class="font-mono font-medium">{barcode.internalCode ?? '—'}</dd>
		</div>
		<div>
			<dt class="text-slate-500">Campaign barcode mode</dt>
			<dd class="font-medium">{barcode.modeLabel}</dd>
		</div>
	</dl>
	{#if !barcode.barcode}
		<p class="mt-3 text-sm text-slate-500">No barcode was recorded for this bond.</p>
	{/if}
	<p class="mt-3 text-xs text-slate-500">
		Loading and searching by scanned barcode come in Phase 4.
	</p>
</RecordSection>

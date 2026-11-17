<script lang="ts">
	import { cardClass } from '$lib/components/campaigns/styles';
	import { BOND_COMMERCIAL_STATUS_LABELS } from '$lib/domain/bonds';
	import { formatInteger, formatMoney } from '$lib/domain/money';
	import { formatBondTimestamp, type BondRecordGeneral } from './types';

	/** Bond record, "General data": type, status, units, value, codes and dates. */
	let { general }: { general: BondRecordGeneral } = $props();
</script>

<section class={cardClass} aria-labelledby="general-title">
	<h2 id="general-title" class="mb-4 text-base font-semibold">General data</h2>
	<dl class="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
		<div>
			<dt class="text-slate-500">Type</dt>
			<dd class="font-medium">{general.typeLabel}</dd>
		</div>
		<div>
			<dt class="text-slate-500">Commercial status</dt>
			<dd class="font-medium">{BOND_COMMERCIAL_STATUS_LABELS[general.commercialStatus]}</dd>
		</div>
		<div>
			<dt class="text-slate-500">Units (N)</dt>
			<dd class="font-medium tabular-nums">{formatInteger(general.unitCount)}</dd>
		</div>
		<div>
			<dt class="text-slate-500">Total value</dt>
			<dd class="font-medium tabular-nums">{formatMoney(general.totalValue)}</dd>
		</div>
		<div>
			<dt class="text-slate-500">Internal code</dt>
			<dd class="font-medium">{general.internalCode ?? '—'}</dd>
		</div>
		<div>
			<dt class="text-slate-500">Barcode</dt>
			<dd class="font-medium">{general.barcode ?? '—'}</dd>
		</div>
		<div>
			<dt class="text-slate-500">Loaded</dt>
			<dd class="font-medium">{formatBondTimestamp(general.createdAt)}</dd>
		</div>
		{#if general.commercialStatus === 'annulled'}
			<div>
				<dt class="text-slate-500">Annulled</dt>
				<dd class="font-medium">{formatBondTimestamp(general.annulledAt)}</dd>
			</div>
			<div>
				<dt class="text-slate-500">Annulment reason</dt>
				<dd class="font-medium">{general.annulReason ?? '—'}</dd>
			</div>
		{/if}
	</dl>
</section>

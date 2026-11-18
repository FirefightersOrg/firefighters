<script lang="ts">
	import { BOND_COMMERCIAL_STATUS_LABELS, BOND_FINANCIAL_STATUS_LABELS } from '$lib/domain/bonds';
	import { formatInteger, formatMoney } from '$lib/domain/money';
	import BondGroupSection from './BondGroupSection.svelte';
	import RecordSection from './RecordSection.svelte';
	import { formatBondTimestamp, type BondRecordGeneral, type BondRecordGroup } from './types';

	/**
	 * Bond record, 1. "General data": type, statuses, units, value, codes and dates, plus the
	 * manual pata composition and ungroup history (or the pata a simple bond is / was in).
	 */
	let {
		campaignId,
		general,
		group
	}: { campaignId: string; general: BondRecordGeneral; group: BondRecordGroup } = $props();
</script>

<RecordSection id="general">
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
			<dt class="text-slate-500">Financial status</dt>
			<dd class="font-medium">{BOND_FINANCIAL_STATUS_LABELS[general.financialStatus]}</dd>
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
			{#if general.annulledFromStatus}
				<div class="sm:col-span-3">
					<dt class="text-slate-500">Annulled from</dt>
					<dd class="font-medium">
						{BOND_COMMERCIAL_STATUS_LABELS[general.annulledFromStatus]}
						<span class="font-normal text-slate-600">
							{general.annulledFromStatus === 'available'
								? '— loaded by mistake: its numbers and codes were freed and can be entered again.'
								: '— its numbers and codes stay held: no other bond can use them.'}
						</span>
					</dd>
				</div>
			{/if}
		{/if}
	</dl>
	<BondGroupSection {campaignId} {group} isManualPata={general.origin === 'manual_grouping'} />
</RecordSection>

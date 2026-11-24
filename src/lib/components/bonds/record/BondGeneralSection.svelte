<script lang="ts">
	import { StatusBadge } from '$lib/components/ui';
	import { formatMoney, formatNumber } from '$lib/format';
	import BondGroupSection from './BondGroupSection.svelte';
	import RecordSection from './RecordSection.svelte';
	import { formatBondTimestamp, type BondRecordGeneral, type BondRecordGroup } from './types';

	/**
	 * Bond record, 1. "Datos generales": type, statuses, units, value, codes and dates, plus the
	 * manual pata composition and ungroup history (or the pata a simple bond is / was in).
	 */
	let {
		campaignId,
		general,
		group
	}: { campaignId: string; general: BondRecordGeneral; group: BondRecordGroup } = $props();
</script>

<RecordSection id="general">
	<dl class="m-0 grid grid-cols-1 gap-x-6 gap-y-4 text-body-sm sm:grid-cols-3">
		<div>
			<dt class="text-muted">Tipo</dt>
			<dd class="m-0 font-medium">{general.typeLabel}</dd>
		</div>
		<div>
			<dt class="text-muted">Estado comercial</dt>
			<dd class="m-0"><StatusBadge kind="bondCommercial" status={general.commercialStatus} /></dd>
		</div>
		<div>
			<dt class="text-muted">Estado financiero</dt>
			<dd class="m-0"><StatusBadge kind="bondFinancial" status={general.financialStatus} /></dd>
		</div>
		<div>
			<dt class="text-muted">Unidades (N)</dt>
			<dd class="m-0 font-medium tabular-nums">{formatNumber(general.unitCount)}</dd>
		</div>
		<div>
			<dt class="text-muted">Valor total</dt>
			<dd class="m-0 font-medium tabular-nums">{formatMoney(general.totalValue)}</dd>
		</div>
		<div>
			<dt class="text-muted">Código interno</dt>
			<dd class="m-0 font-mono font-medium">{general.internalCode ?? '—'}</dd>
		</div>
		<div>
			<dt class="text-muted">Cargado</dt>
			<dd class="m-0 font-medium">{formatBondTimestamp(general.createdAt)}</dd>
		</div>
		{#if general.commercialStatus === 'annulled'}
			<div>
				<dt class="text-muted">Anulado</dt>
				<dd class="m-0 font-medium">{formatBondTimestamp(general.annulledAt)}</dd>
			</div>
			<div>
				<dt class="text-muted">Motivo de la anulación</dt>
				<dd class="m-0 font-medium">{general.annulReason ?? '—'}</dd>
			</div>
			{#if general.annulledFromStatus}
				<div class="sm:col-span-3">
					<dt class="text-muted">Anulado desde el estado</dt>
					<dd class="m-0 flex flex-wrap items-center gap-2">
						<StatusBadge kind="bondCommercial" status={general.annulledFromStatus} />
						<span class="text-muted">
							{general.annulledFromStatus === 'available'
								? 'Cargado por error: sus números y códigos quedaron libres y se pueden ingresar de nuevo.'
								: 'Sus números y códigos siguen retenidos: ningún otro bono puede usarlos.'}
						</span>
					</dd>
				</div>
			{/if}
		{/if}
	</dl>
	<BondGroupSection {campaignId} {group} isManualPata={general.origin === 'manual_grouping'} />
</RecordSection>

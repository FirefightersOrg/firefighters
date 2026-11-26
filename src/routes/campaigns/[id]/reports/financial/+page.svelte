<script lang="ts">
	import { institutionName } from '$lib/institution';
	import { resolve } from '$app/paths';
	import Button from '$lib/components/ui/Button.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import Section from '$lib/components/ui/Section.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import TextInput from '$lib/components/ui/TextInput.svelte';
	import ExportLinks from '$lib/components/reports/ExportLinks.svelte';
	import {
		formatSignedMoney,
		PAYMENT_METHODS,
		PAYMENT_METHOD_LABELS,
		ROSTER_ELIGIBILITY_FILTERS,
		SETTLEMENT_STATUSES,
		SETTLEMENT_STATUS_LABELS,
		type PaymentMethod,
		type SettlementStatus
	} from '$lib/domain/financial-reports';
	import {
		LEDGER_DIRECTION_LABELS,
		LEDGER_ENTRY_TYPE_LABELS,
		LEDGER_STATUS_LABELS
	} from '$lib/domain/ledger';
	import type { LedgerDirection, LedgerEntryType, LedgerStatus } from '$lib/domain/ledger';
	import { formatInteger, formatMoney } from '$lib/domain/money';
	import {
		PRIZE_STATUSES,
		PRIZE_STATUS_LABELS,
		WINNING_NUMBER_STATUS_LABELS
	} from '$lib/domain/prizes';
	import type { PrizeStatus, WinningNumberStatus } from '$lib/domain/prizes';
	import { drawStatusLabel, drawTypeLabel } from '$lib/domain/report-exports';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const campaign = $derived(data.campaign);
	const filters = $derived(data.filters);
	const exportParams = $derived({
		collector: filters.collectorId,
		method: filters.method,
		settlement: filters.settlementStatus,
		from: filters.from,
		to: filters.to,
		draw: filters.drawId,
		eligibility: filters.eligibility,
		prize: filters.prizeStatus
	});
	const prizeLabel = (s: string) => PRIZE_STATUS_LABELS[s as PrizeStatus] ?? s;

	const th = 'px-3 py-2 text-left text-label text-muted';
	const thRight = 'px-3 py-2 text-right text-label text-muted';
	const td = 'px-3 py-2 text-text';
	const tdRight = 'px-3 py-2 text-right tabular-nums text-text';
	const withAll = (options: { value: string; label: string }[], all = 'Todos') => [
		{ value: '', label: all },
		...options
	];
	const collectorOptions = $derived(
		withAll([
			...data.collectors.map((c) => ({ value: c.id, label: c.displayName })),
			...(filters.collectorId && !data.collectors.some((c) => c.id === filters.collectorId)
				? [{ value: filters.collectorId, label: 'Cobrador seleccionado' }]
				: [])
		])
	);
	const methodOptions = withAll(
		PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m as PaymentMethod] }))
	);
	const settlementOptions = withAll(
		SETTLEMENT_STATUSES.map((v) => ({
			value: v,
			label: SETTLEMENT_STATUS_LABELS[v as SettlementStatus]
		}))
	);
	const drawOptions = $derived(
		withAll(data.draws.map((d) => ({ value: d.drawId, label: d.drawName })))
	);
	const eligibilityOptions = withAll(
		ROSTER_ELIGIBILITY_FILTERS.map((e) => ({
			value: e,
			label: e === 'eligible' ? 'Solo elegibles' : 'Solo no elegibles'
		})),
		'Elegibles y no elegibles'
	);
	const prizeOptions = withAll(
		PRIZE_STATUSES.map((v) => ({ value: v, label: PRIZE_STATUS_LABELS[v] }))
	);
</script>

<svelte:head
	><title>Reportes financieros - {campaign.name} - {institutionName()}</title></svelte:head
>

<div class="space-y-6">
	<div>
		<a
			href={resolve('/campaigns/[id]/reports', { id: campaign.id })}
			class="text-sm text-primary-text hover:underline">← Reportes operativos</a
		>
		<h1 class="mt-2 text-heading-1">Reportes financieros y de sorteos</h1>
		<p class="mt-1 text-sm text-muted">
			Vistas de solo lectura de los datos actuales de {campaign.name}. No se cuentan los pagos en
			borrador ni anulados. Los padrones de sorteo son los padrones congelados. Las fechas son de
			Buenos Aires.
		</p>
	</div>

	<form
		method="GET"
		class="grid gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm sm:grid-cols-3 sm:items-end lg:grid-cols-4"
	>
		<Field label="Cobrador" id="collector">
			<Select name="collector" options={collectorOptions} value={filters.collectorId ?? ''} />
		</Field>
		<Field label="Medio de pago" id="method">
			<Select name="method" options={methodOptions} value={filters.method ?? ''} />
		</Field>
		<Field label="Estado de la liquidación" id="settlement">
			<Select
				name="settlement"
				options={settlementOptions}
				value={filters.settlementStatus ?? ''}
			/>
		</Field>
		<Field label="Desde (pagos, liquidaciones, cuenta)" id="from">
			<TextInput name="from" type="date" value={filters.from ?? ''} />
		</Field>
		<Field label="Hasta" id="to">
			<TextInput name="to" type="date" value={filters.to ?? ''} />
		</Field>
		<Field label="Sorteo (padrón y premios)" id="draw">
			<Select name="draw" options={drawOptions} value={filters.drawId ?? ''} />
		</Field>
		<Field label="Números del padrón" id="eligibility">
			<Select name="eligibility" options={eligibilityOptions} value={filters.eligibility ?? ''} />
		</Field>
		<Field label="Estado del premio" id="prize">
			<Select name="prize" options={prizeOptions} value={filters.prizeStatus ?? ''} />
		</Field>
		<div class="flex gap-2">
			<Button type="submit" variant="primary">Aplicar</Button>
			<Button href={resolve('/campaigns/[id]/reports/financial', { id: campaign.id })}
				>Limpiar</Button
			>
		</div>
	</form>

	<Section id="payments" title="Pagos por fecha y medio de pago">
		{#snippet actions()}
			<ExportLinks
				campaignId={campaign.id}
				report="payments-by-date"
				params={exportParams}
				show={data.canExport}
			/>
		{/snippet}
		{#if data.payments.days.length === 0}
			<p class="text-sm text-muted">Ningún pago coincide con los filtros.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="min-w-full divide-y divide-border text-sm">
					<thead>
						<tr>
							<th class={th}>Fecha</th>
							<th class={thRight}>Efectivo</th>
							<th class={thRight}>Transferencia</th>
							<th class={thRight}>Pagos</th>
							<th class={thRight}>Total</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-border">
						{#each data.payments.days as d (d.paymentDate)}
							<tr>
								<td class={td}>{d.paymentDate}</td>
								<td class={tdRight}>{formatMoney(d.cash)}</td>
								<td class={tdRight}>{formatMoney(d.transfer)}</td>
								<td class={tdRight}>{formatInteger(d.count)}</td>
								<td class={tdRight}>{formatMoney(d.total)}</td>
							</tr>
						{/each}
					</tbody>
					<tfoot>
						<tr class="font-semibold">
							<td class={td}>Total</td>
							<td class={tdRight}>{formatMoney(data.payments.totals.cash)}</td>
							<td class={tdRight}>{formatMoney(data.payments.totals.transfer)}</td>
							<td class={tdRight}>{formatInteger(data.payments.totals.count)}</td>
							<td class={tdRight}>{formatMoney(data.payments.totals.total)}</td>
						</tr>
					</tfoot>
				</table>
			</div>
		{/if}
	</Section>

	<Section id="settlements" title="Liquidaciones por cobrador">
		{#snippet actions()}
			<ExportLinks
				campaignId={campaign.id}
				report="settlements-by-collector"
				params={exportParams}
				show={data.canExport}
			/>
		{/snippet}
		{#if data.settlements.rows.length === 0}
			<p class="text-sm text-muted">Ninguna liquidación coincide con los filtros.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="min-w-full divide-y divide-border text-sm">
					<thead>
						<tr>
							<th class={th}>Cobrador</th>
							<th class={th}>Estado</th>
							<th class={thRight}>Liquidaciones</th>
							<th class={thRight}>Efectivo</th>
							<th class={thRight}>Transferencia</th>
							<th class={thRight}>Total</th>
							<th class={thRight}>Comisión</th>
							<th class={thRight}>Comisión pagada</th>
							<th class={thRight}>Neto para bomberos</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-border">
						{#each data.settlements.rows as r (r.collectorId + r.status)}
							<tr>
								<td class={td}>{r.collectorName}</td>
								<td class={td}
									>{SETTLEMENT_STATUS_LABELS[r.status as SettlementStatus] ?? r.status}</td
								>
								<td class={tdRight}>{formatInteger(r.settlementCount)}</td>
								<td class={tdRight}>{formatMoney(r.totalCash)}</td>
								<td class={tdRight}>{formatMoney(r.totalTransfer)}</td>
								<td class={tdRight}>{formatMoney(r.totalAmount)}</td>
								<td class={tdRight}>{formatMoney(r.commissionAmount)}</td>
								<td class={tdRight}>{formatMoney(r.commissionPaidAmount)}</td>
								<td class={tdRight}>{formatMoney(r.netToFirefighters)}</td>
							</tr>
						{/each}
					</tbody>
					<tfoot>
						<tr class="font-semibold">
							<td class={td} colspan="2">Total</td>
							<td class={tdRight}>{formatInteger(data.settlements.totals.settlementCount)}</td>
							<td class={tdRight}>{formatMoney(data.settlements.totals.totalCash)}</td>
							<td class={tdRight}>{formatMoney(data.settlements.totals.totalTransfer)}</td>
							<td class={tdRight}>{formatMoney(data.settlements.totals.totalAmount)}</td>
							<td class={tdRight}>{formatMoney(data.settlements.totals.commissionAmount)}</td>
							<td class={tdRight}>{formatMoney(data.settlements.totals.commissionPaidAmount)}</td>
							<td class={tdRight}>{formatMoney(data.settlements.totals.netToFirefighters)}</td>
						</tr>
					</tfoot>
				</table>
			</div>
		{/if}
	</Section>

	<Section id="accounts" title="Cuentas corrientes de cobradores">
		{#snippet actions()}
			<ExportLinks
				campaignId={campaign.id}
				report="collector-accounts"
				params={exportParams}
				show={data.canExport}
			/>
		{/snippet}
		{#if data.accounts.rows.length === 0}
			<p class="text-sm text-muted">Ningún asiento de cuenta coincide con los filtros.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="min-w-full divide-y divide-border text-sm">
					<thead>
						<tr>
							<th class={th}>Cobrador</th>
							<th class={thRight}>Asientos</th>
							<th class={thRight}>Créditos</th>
							<th class={thRight}>Débitos</th>
							<th class={thRight}>Saldo</th>
							<th class={th}>Último asiento</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-border">
						{#each data.accounts.rows as r (r.collectorId)}
							<tr>
								<td class={td}>
									<a
										class="text-primary-text hover:underline"
										href="{resolve('/campaigns/[id]/reports/financial', {
											id: campaign.id
										})}?collector={r.collectorId}">{r.collectorName}</a
									>
								</td>
								<td class={tdRight}>{formatInteger(r.entryCount)}</td>
								<td class={tdRight}>{formatMoney(r.creditTotal)}</td>
								<td class={tdRight}>{formatMoney(r.debitTotal)}</td>
								<td class={tdRight}>{formatSignedMoney(r.balance)}</td>
								<td class={td}>{r.lastEntryOn ?? ''}</td>
							</tr>
						{/each}
					</tbody>
					<tfoot>
						<tr class="font-semibold">
							<td class={td}>Total</td>
							<td class={tdRight}>{formatInteger(data.accounts.totals.entryCount)}</td>
							<td class={tdRight}>{formatMoney(data.accounts.totals.creditTotal)}</td>
							<td class={tdRight}>{formatMoney(data.accounts.totals.debitTotal)}</td>
							<td class={tdRight}>{formatSignedMoney(data.accounts.totals.balance)}</td>
							<td class={td}></td>
						</tr>
					</tfoot>
				</table>
			</div>
		{/if}

		<div class="mt-5 border-t border-border pt-4">
			<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
				<h3 class="text-sm font-semibold">Detalle de la cuenta</h3>
				{#if data.ledger}
					<ExportLinks
						campaignId={campaign.id}
						report="collector-ledger"
						params={exportParams}
						show={data.canExport}
					/>
				{/if}
			</div>
			{#if !data.ledger}
				<p class="text-sm text-muted">Elegir un cobrador para ver el detalle de la cuenta.</p>
			{:else if data.ledger.length === 0}
				<p class="text-sm text-muted">No hay asientos de cuenta en este período.</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="min-w-full divide-y divide-border text-sm">
						<thead>
							<tr>
								<th class={th}>Fecha</th>
								<th class={th}>Tipo</th>
								<th class={th}>Sentido</th>
								<th class={thRight}>Importe</th>
								<th class={th}>Estado</th>
								<th class={thRight}>Liquidación</th>
								<th class={th}>Motivo</th>
								<th class={thRight}>Saldo</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-border">
							{#each data.ledger as e (e.entryId)}
								<tr>
									<td class={td}>{e.occurredOn} {e.occurredTime}</td>
									<td class={td}
										>{LEDGER_ENTRY_TYPE_LABELS[e.entryType as LedgerEntryType] ??
											e.entryType}{#if !e.affectsBalance}<span class="block text-body-sm text-muted"
												>Referencia: no cambia el saldo.</span
											>{/if}</td
									>
									<td class={td}
										>{LEDGER_DIRECTION_LABELS[e.direction as LedgerDirection] ?? e.direction}</td
									>
									<td class={tdRight}>{formatMoney(e.amount)}</td>
									<td class={td}>{LEDGER_STATUS_LABELS[e.status as LedgerStatus] ?? e.status}</td>
									<td class={tdRight}>{e.settlementNumber ?? ''}</td>
									<td class={td}>{e.reason ?? ''}</td>
									<td class={tdRight}>{formatSignedMoney(e.runningBalance)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	</Section>

	<Section id="rosters" title="Padrones de sorteo">
		{#if data.draws.length === 0}
			<p class="text-sm text-muted">Esta campaña no tiene sorteos.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="min-w-full divide-y divide-border text-sm">
					<thead>
						<tr>
							<th class={th}>Sorteo</th>
							<th class={th}>Tipo</th>
							<th class={th}>Fecha</th>
							<th class={th}>Estado</th>
							<th class={th}>Padrón congelado</th>
							<th class={thRight}>Elegibles</th>
							<th class={thRight}>No elegibles</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-border">
						{#each data.draws as d (d.drawId)}
							<tr>
								<td class={td}>
									<a
										class="text-primary-text hover:underline"
										href="{resolve('/campaigns/[id]/reports/financial', {
											id: campaign.id
										})}?draw={d.drawId}">{d.drawName}</a
									>
								</td>
								<td class={td}>{drawTypeLabel(d.drawType)}</td>
								<td class={td}>{d.drawDate}</td>
								<td class={td}>{drawStatusLabel(d.drawStatus)}</td>
								<td class={td}>{d.rosterStatus ? 'Congelado' : 'No congelado'}</td>
								<td class={tdRight}>{formatInteger(d.eligibleCount)}</td>
								<td class={tdRight}>{formatInteger(d.ineligibleCount)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		<div class="mt-5 border-t border-border pt-4">
			<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
				<h3 class="text-sm font-semibold">
					Números del padrón{data.selectedDraw ? ` - ${data.selectedDraw.drawName}` : ''}
				</h3>
				{#if data.roster}
					<ExportLinks
						campaignId={campaign.id}
						report="draw-roster"
						params={exportParams}
						show={data.canExport}
					/>
				{/if}
			</div>
			{#if !data.roster}
				<p class="text-sm text-muted">Elegir un sorteo para ver los números de su padrón.</p>
			{:else if data.roster.length === 0}
				<p class="text-sm text-muted">
					Ningún número del padrón coincide (puede que el padrón no esté congelado).
				</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="min-w-full divide-y divide-border text-sm">
						<thead>
							<tr>
								<th class={thRight}>Número</th>
								<th class={th}>Elegibles</th>
								<th class={th}>Motivo</th>
								<th class={th}>Comprador</th>
								<th class={th}>Cobrador</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-border">
							{#each data.roster as e (e.numberValue)}
								<tr>
									<td class={tdRight}>{e.numberValue}</td>
									<td class={td}>{e.eligible ? 'Sí' : 'No'}</td>
									<td class={td}>{e.ineligibilityReason ?? ''}</td>
									<td class={td}>{e.buyerName ?? ''}</td>
									<td class={td}>{e.collectorName ?? ''}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				{#if data.rosterTruncated}
					<p class="mt-2 text-sm text-muted">
						Se muestran los primeros {formatInteger(data.roster.length)} números. La exportación tiene
						todos.
					</p>
				{/if}
			{/if}
		</div>
	</Section>

	<Section id="prizes" title="Ganadores y premios">
		{#snippet actions()}
			<ExportLinks
				campaignId={campaign.id}
				report="prizes"
				params={exportParams}
				show={data.canExport}
			/>
		{/snippet}
		{#if data.prizes.rows.length === 0}
			<p class="text-sm text-muted">Ningún premio coincide con los filtros.</p>
		{:else}
			<ul class="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-text">
				{#each PRIZE_STATUSES as s (s)}
					{#if data.prizes.counts[s]}
						<li>
							{PRIZE_STATUS_LABELS[s]}: <strong>{formatInteger(data.prizes.counts[s])}</strong>
						</li>
					{/if}
				{/each}
			</ul>
			<div class="overflow-x-auto">
				<table class="min-w-full divide-y divide-border text-sm">
					<thead>
						<tr>
							<th class={th}>Sorteo</th>
							<th class={thRight}>Posición</th>
							<th class={th}>Premio</th>
							<th class={th}>Estado</th>
							<th class={thRight}>Número</th>
							<th class={th}>Resultado</th>
							<th class={th}>Comprador</th>
							<th class={th}>Cobrador</th>
							<th class={th}>Adjudicado</th>
							<th class={th}>Entregado</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-border">
						{#each data.prizes.rows as p (p.prizeId)}
							<tr>
								<td class={td}>{p.drawName}</td>
								<td class={tdRight}>{p.position}</td>
								<td class={td}>{p.prizeName}</td>
								<td class={td}>{prizeLabel(p.prizeStatus)}</td>
								<td class={tdRight}>{p.winningNumber ?? ''}</td>
								<td class={td}
									>{p.resultStatus
										? (WINNING_NUMBER_STATUS_LABELS[p.resultStatus as WinningNumberStatus] ??
											p.resultStatus)
										: ''}</td
								>
								<td class={td}>{p.buyerName ?? ''}</td>
								<td class={td}>{p.collectorName ?? ''}</td>
								<td class={td}>{p.awardedOn ?? ''}</td>
								<td class={td}>{p.deliveredOn ?? ''}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</Section>
</div>

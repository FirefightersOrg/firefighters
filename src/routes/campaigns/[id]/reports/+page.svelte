<script lang="ts">
	import { resolve } from '$app/paths';
	import Button from '$lib/components/ui/Button.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import Section from '$lib/components/ui/Section.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import TextInput from '$lib/components/ui/TextInput.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import { formatDate } from '$lib/format';
	import {
		BOND_COMMERCIAL_STATUSES,
		BOND_COMMERCIAL_STATUS_LABELS,
		BOND_FINANCIAL_STATUSES,
		BOND_FINANCIAL_STATUS_LABELS,
		BOND_KIND_LABELS,
		BOND_KINDS,
		type BondCommercialStatus,
		type BondFinancialStatus
	} from '$lib/domain/bonds';
	import ExportLinks from '$lib/components/reports/ExportLinks.svelte';
	import { formatInteger, formatMoney } from '$lib/domain/money';
	import {
		formatMonthLabel,
		INSTALLMENT_BUCKET_LABELS,
		INSTALLMENT_BUCKETS
	} from '$lib/domain/reports';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const overdue = $derived(data.overdueWarning);
	const thresholdForm = $derived(
		form?.form === 'setOverdueThreshold'
			? (form as {
					success?: boolean;
					message?: string | null;
					fieldError?: string | null;
					threshold?: string;
				})
			: null
	);
	const cuotas = (n: number) => (n === 1 ? 'cuota vencida' : 'cuotas vencidas');
	const campaign = $derived(data.campaign);
	const filters = $derived(data.filters);
	const exportParams = $derived({
		collector: filters.collectorId,
		kind: filters.kind,
		status: filters.commercialStatus,
		financial: filters.financialStatus,
		month: filters.month,
		from: filters.from,
		to: filters.to
	});
	const matrix = $derived(data.bondsByStatus);
	const commercialLabel = (s: string) =>
		BOND_COMMERCIAL_STATUS_LABELS[s as BondCommercialStatus] ?? s;
	const financialLabel = (s: string) => BOND_FINANCIAL_STATUS_LABELS[s as BondFinancialStatus] ?? s;

	const th = 'px-3 py-2 text-left text-label text-muted';
	const thRight = 'px-3 py-2 text-right text-label text-muted';
	const td = 'px-3 py-2 text-text';
	const tdRight = 'px-3 py-2 text-right tabular-nums text-text';
	const withAll = (options: { value: string; label: string }[]) => [
		{ value: '', label: 'Todos' },
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
	const kindOptions = withAll(BOND_KINDS.map((k) => ({ value: k, label: BOND_KIND_LABELS[k] })));
	const commercialOptions = withAll(
		BOND_COMMERCIAL_STATUSES.map((s) => ({ value: s, label: BOND_COMMERCIAL_STATUS_LABELS[s] }))
	);
	const financialOptions = withAll(
		BOND_FINANCIAL_STATUSES.map((s) => ({ value: s, label: BOND_FINANCIAL_STATUS_LABELS[s] }))
	);
</script>

<svelte:head><title>Reportes operativos - {campaign.name} - Firefighters</title></svelte:head>

<div class="space-y-6">
	<div>
		<a
			href={resolve('/campaigns/[id]', { id: campaign.id })}
			class="text-body-sm text-primary-text hover:underline">← {campaign.name}</a
		>
		<h1 class="mt-2 text-heading-1">Reportes operativos</h1>
		{#if data.canViewFinancial}
			<a
				href={resolve('/campaigns/[id]/reports/financial', { id: campaign.id })}
				class="mt-1 inline-flex min-h-11 items-center text-body-sm text-primary-text hover:underline"
				>Reportes financieros y de sorteos →</a
			>
		{/if}
		<p class="mt-1 text-body-sm text-muted">
			Vistas de solo lectura de los datos actuales. El estado financiero es el último estado
			recalculado del bono (se actualiza al cerrar una liquidación). Las fechas son de Buenos Aires.
		</p>
	</div>

	<form
		method="GET"
		class="grid gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm sm:grid-cols-3 sm:items-end lg:grid-cols-4"
	>
		<Field label="Cobrador" id="collector">
			<Select name="collector" options={collectorOptions} value={filters.collectorId ?? ''} />
		</Field>
		<Field label="Tipo de bono" id="kind">
			<Select name="kind" options={kindOptions} value={filters.kind ?? ''} />
		</Field>
		<Field label="Estado comercial" id="status">
			<Select name="status" options={commercialOptions} value={filters.commercialStatus ?? ''} />
		</Field>
		<Field label="Estado financiero" id="financial">
			<Select name="financial" options={financialOptions} value={filters.financialStatus ?? ''} />
		</Field>
		<Field label="Mes (resumen mensual)" id="month">
			<TextInput name="month" type="month" value={filters.month} />
		</Field>
		<Field label="Cuotas con vencimiento desde" id="from">
			<TextInput name="from" type="date" value={filters.from ?? ''} />
		</Field>
		<Field label="Cuotas con vencimiento hasta" id="to">
			<TextInput name="to" type="date" value={filters.to ?? ''} />
		</Field>
		<div class="flex gap-2">
			<Button type="submit" variant="primary">Aplicar</Button>
			<Button href={resolve('/campaigns/[id]/reports', { id: campaign.id })}>Limpiar</Button>
		</div>
	</form>

	<Section id="by-status" title="Bonos por estado comercial y financiero">
		<div class="mb-3">
			<ExportLinks
				campaignId={campaign.id}
				report="bonds-by-status"
				params={exportParams}
				show={data.canExport}
			/>
		</div>
		{#if matrix.bondCount === 0}
			<p class="text-body-sm text-muted">Ningún bono coincide con los filtros.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="min-w-full divide-y divide-border text-body-sm">
					<thead>
						<tr>
							<th class={th}>Estado comercial</th>
							{#each matrix.financialStatuses as f (f)}
								<th class={thRight}>{financialLabel(f)}</th>
							{/each}
							<th class={thRight}>Bonos</th>
							<th class={thRight}>Valor</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-border">
						{#each matrix.commercialStatuses as c (c)}
							<tr>
								<td class={td}>{commercialLabel(c)}</td>
								{#each matrix.financialStatuses as f (f)}
									<td class={tdRight}>{formatInteger(matrix.cells[c]?.[f] ?? 0)}</td>
								{/each}
								<td class={tdRight}>{formatInteger(matrix.commercialTotals[c]!.bondCount)}</td>
								<td class={tdRight}>{formatMoney(matrix.commercialTotals[c]!.totalValue)}</td>
							</tr>
						{/each}
					</tbody>
					<tfoot>
						<tr class="font-semibold">
							<td class={td}>Total</td>
							{#each matrix.financialStatuses as f (f)}
								<td class={tdRight}>{formatInteger(matrix.financialTotals[f] ?? 0)}</td>
							{/each}
							<td class={tdRight}>{formatInteger(matrix.bondCount)}</td>
							<td class={tdRight}>{formatMoney(matrix.totalValue)}</td>
						</tr>
					</tfoot>
				</table>
			</div>
		{/if}
	</Section>

	<Section id="by-collector" title="Bonos por cobrador">
		<div class="mb-3">
			<ExportLinks
				campaignId={campaign.id}
				report="bonds-by-collector"
				params={exportParams}
				show={data.canExport}
			/>
		</div>
		{#if data.bondsByCollector.rows.length === 0}
			<p class="text-body-sm text-muted">Ningún bono coincide con los filtros.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="min-w-full divide-y divide-border text-body-sm">
					<thead>
						<tr>
							<th class={th}>Cobrador</th>
							<th class={thRight}>Bonos</th>
							<th class={thRight}>Entregados</th>
							<th class={thRight}>Vendidos</th>
							<th class={thRight}>Devueltos</th>
							<th class={thRight}>Valor</th>
							<th class={thRight}>Valor vendido</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-border">
						{#each data.bondsByCollector.rows as r (r.collectorId ?? 'unassigned')}
							<tr>
								<td class={td}>
									{#if r.collectorId}
										<a
											class="text-primary-text hover:underline"
											href={resolve('/campaigns/[id]/collectors/[collectorId]', {
												id: campaign.id,
												collectorId: r.collectorId
											})}>{r.collectorName ?? 'Cobrador'}</a
										>
									{:else}
										<span class="text-muted">Sin asignar</span>
									{/if}
								</td>
								<td class={tdRight}>{formatInteger(r.bondCount)}</td>
								<td class={tdRight}>{formatInteger(r.deliveredCount)}</td>
								<td class={tdRight}>{formatInteger(r.soldCount)}</td>
								<td class={tdRight}>{formatInteger(r.returnedCount)}</td>
								<td class={tdRight}>{formatMoney(r.totalValue)}</td>
								<td class={tdRight}>{formatMoney(r.soldValue)}</td>
							</tr>
						{/each}
					</tbody>
					<tfoot>
						<tr class="font-semibold">
							<td class={td}>Total</td>
							<td class={tdRight}>{formatInteger(data.bondsByCollector.totals.bondCount)}</td>
							<td class={tdRight}>{formatInteger(data.bondsByCollector.totals.deliveredCount)}</td>
							<td class={tdRight}>{formatInteger(data.bondsByCollector.totals.soldCount)}</td>
							<td class={tdRight}>{formatInteger(data.bondsByCollector.totals.returnedCount)}</td>
							<td class={tdRight}>{formatMoney(data.bondsByCollector.totals.totalValue)}</td>
							<td class={tdRight}>{formatMoney(data.bondsByCollector.totals.soldValue)}</td>
						</tr>
					</tfoot>
				</table>
			</div>
		{/if}
	</Section>

	<Section id="installments" title="Cuotas: pendientes, pagadas, adelantadas y vencidas">
		<div class="mb-3">
			<ExportLinks
				campaignId={campaign.id}
				report="installments"
				params={exportParams}
				show={data.canExport}
			/>
		</div>
		<p class="mb-3 text-body-sm text-muted">
			Solo ventas activas. Las vencidas incluyen cuotas pendientes con fecha de vencimiento pasada.
			Cada celda muestra cantidad e importe.
		</p>
		{#if data.installments.collectors.length === 0}
			<p class="text-body-sm text-muted">Ninguna cuota coincide con los filtros.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="min-w-full divide-y divide-border text-body-sm">
					<thead>
						<tr>
							<th class={th}>Cobrador</th>
							{#each INSTALLMENT_BUCKETS as b (b)}
								<th class={thRight}>{INSTALLMENT_BUCKET_LABELS[b]}</th>
							{/each}
						</tr>
					</thead>
					<tbody class="divide-y divide-border">
						{#each data.installments.collectors as c (c.collectorId)}
							<tr>
								<td class={td}>{c.collectorName}</td>
								{#each INSTALLMENT_BUCKETS as b (b)}
									<td class={tdRight}
										>{formatInteger(c.buckets[b].count)} · {formatMoney(c.buckets[b].amount)}</td
									>
								{/each}
							</tr>
						{/each}
					</tbody>
					<tfoot>
						<tr class="font-semibold">
							<td class={td}>Total</td>
							{#each INSTALLMENT_BUCKETS as b (b)}
								<td class={tdRight}
									>{formatInteger(data.installments.totals[b].count)} · {formatMoney(
										data.installments.totals[b].amount
									)}</td
								>
							{/each}
						</tr>
					</tfoot>
				</table>
			</div>
		{/if}
	</Section>

	<Section
		id="overdue-warning"
		title={`Ventas con ${overdue.threshold} o más ${cuotas(overdue.threshold)}`}
	>
		<p class="mb-3 text-body-sm text-muted">
			Aviso informativo: no marca ninguna venta como incobrable. Solo ventas activas que no están
			marcadas como incobrables. Respeta el filtro de cobrador.
		</p>
		{#if thresholdForm?.message}
			<div class="mb-3">
				<Alert tone={thresholdForm.success ? 'success' : 'danger'}>{thresholdForm.message}</Alert>
			</div>
		{/if}
		{#if overdue.canEdit}
			<form
				method="POST"
				action="?/setOverdueThreshold"
				class="mb-4 flex flex-wrap items-end gap-3"
			>
				<Field
					label="Avisar desde (cuotas vencidas)"
					id="overdue-threshold"
					hint="Entre 1 y 120. Vale para toda la campaña."
					error={thresholdForm?.fieldError ?? undefined}
				>
					<TextInput
						name="threshold"
						inputmode="numeric"
						autocomplete="off"
						value={thresholdForm && !thresholdForm.success
							? (thresholdForm.threshold ?? '')
							: String(overdue.threshold)}
					/>
				</Field>
				<Button type="submit">Guardar</Button>
			</form>
		{/if}
		{#if overdue.sales.length === 0}
			<p class="text-body-sm text-muted">
				Ninguna venta tiene {overdue.threshold} o más {cuotas(overdue.threshold)}.
			</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="min-w-full divide-y divide-border text-body-sm">
					<thead>
						<tr>
							<th class={th}>Bono</th>
							<th class={th}>Cobrador</th>
							<th class={thRight}>Cuotas vencidas</th>
							<th class={thRight}>Importe vencido</th>
							<th class={th}>Vencida desde</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-border">
						{#each overdue.sales as sale (sale.saleId)}
							<tr>
								<td class={td}>
									{#if overdue.canViewSales}
										<a
											class="text-primary-text hover:underline"
											href={resolve('/campaigns/[id]/sales/[saleId]', {
												id: campaign.id,
												saleId: sale.saleId
											})}>{sale.bondLabel}</a
										>
									{:else}
										{sale.bondLabel}
									{/if}
								</td>
								<td class={td}>{sale.collectorName}</td>
								<td class={tdRight}>{formatInteger(sale.overdueCount)}</td>
								<td class={tdRight}>{formatMoney(sale.overdueAmount)}</td>
								<td class={td}>{formatDate(sale.oldestDueDate)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</Section>

	<Section id="monthly" title={`Resumen mensual por cobrador: ${formatMonthLabel(filters.month)}`}>
		<div class="mb-3">
			<ExportLinks
				campaignId={campaign.id}
				report="collector-monthly"
				params={exportParams}
				show={data.canExport}
			/>
		</div>
		<p class="mb-3 text-body-sm text-muted">
			Los bonos asignados son los que se tienen hoy. Vendidos son las ventas registradas en el mes.
			Las cuotas son las que vencen en el mes y siguen impagas. Los pagos excluyen borradores y
			pagos anulados.
		</p>
		{#if data.monthly.rows.length === 0}
			<p class="text-body-sm text-muted">No hubo actividad de cobradores en este mes.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="min-w-full divide-y divide-border text-body-sm">
					<thead>
						<tr>
							<th class={th}>Cobrador</th>
							<th class={thRight}>Asignados</th>
							<th class={thRight}>Vendidos</th>
							<th class={thRight}>Valor vendido</th>
							<th class={thRight}>Cuotas pendientes</th>
							<th class={thRight}>Cuotas vencidas</th>
							<th class={thRight}>Pagos</th>
							<th class={thRight}>Efectivo</th>
							<th class={thRight}>Transferencia</th>
							<th class={thRight}>Cobrado</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-border">
						{#each data.monthly.rows as r (r.collectorId)}
							<tr>
								<td class={td}>
									<a
										class="text-primary-text hover:underline"
										href={resolve('/campaigns/[id]/collectors/[collectorId]', {
											id: campaign.id,
											collectorId: r.collectorId
										})}>{r.collectorName}</a
									>
								</td>
								<td class={tdRight}>{formatInteger(r.assignedBonds)}</td>
								<td class={tdRight}>{formatInteger(r.soldBonds)}</td>
								<td class={tdRight}>{formatMoney(r.soldValue)}</td>
								<td class={tdRight}
									>{formatInteger(r.pendingInstallments)} · {formatMoney(r.pendingAmount)}</td
								>
								<td class={tdRight}
									>{formatInteger(r.overdueInstallments)} · {formatMoney(r.overdueAmount)}</td
								>
								<td class={tdRight}>{formatInteger(r.paymentsCount)}</td>
								<td class={tdRight}>{formatMoney(r.paymentsCash)}</td>
								<td class={tdRight}>{formatMoney(r.paymentsTransfer)}</td>
								<td class={tdRight}>{formatMoney(r.paymentsTotal)}</td>
							</tr>
						{/each}
					</tbody>
					<tfoot>
						<tr class="font-semibold">
							<td class={td}>Total</td>
							<td class={tdRight}>{formatInteger(data.monthly.totals.assignedBonds)}</td>
							<td class={tdRight}>{formatInteger(data.monthly.totals.soldBonds)}</td>
							<td class={tdRight}>{formatMoney(data.monthly.totals.soldValue)}</td>
							<td class={tdRight}
								>{formatInteger(data.monthly.totals.pendingInstallments)} · {formatMoney(
									data.monthly.totals.pendingAmount
								)}</td
							>
							<td class={tdRight}
								>{formatInteger(data.monthly.totals.overdueInstallments)} · {formatMoney(
									data.monthly.totals.overdueAmount
								)}</td
							>
							<td class={tdRight}>{formatInteger(data.monthly.totals.paymentsCount)}</td>
							<td class={tdRight}>{formatMoney(data.monthly.totals.paymentsCash)}</td>
							<td class={tdRight}>{formatMoney(data.monthly.totals.paymentsTransfer)}</td>
							<td class={tdRight}>{formatMoney(data.monthly.totals.paymentsTotal)}</td>
						</tr>
					</tfoot>
				</table>
			</div>
		{/if}
	</Section>
</div>

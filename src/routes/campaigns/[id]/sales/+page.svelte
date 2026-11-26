<script lang="ts">
	import { institutionName } from '$lib/institution';
	import { resolve } from '$app/paths';
	import {
		BondNumber,
		Button,
		EmptyState,
		Field,
		FilterBar,
		Money,
		PageHeader,
		Select,
		StatusBadge,
		statusMeta,
		Table,
		type AppliedFilter,
		type TableColumn
	} from '$lib/components/ui';
	import { campaignNumberingConfig } from '$lib/domain/campaigns';
	import { FINANCIAL_STATUSES } from '$lib/domain/financial-status';
	import { formatCampaignNumber } from '$lib/domain/numbering';
	import { isReadableName } from '$lib/domain/parties';
	import { PAYMENT_MODE_LABELS } from '$lib/domain/sales';
	import { formatDate, formatNumber } from '$lib/format';
	import { listUrl, showingRange } from '$lib/list-query';
	import type { PageProps } from './$types';

	/**
	 * Sales list (UX plan PR 14, audit A7 and A9). A row names the sale as people say it, the bond
	 * and who bought it, then how its payments stand and what it is worth. The buyer's name is the
	 * search; the other filters are folded. GET filters (they live in the query string), server-side
	 * pages. Below 720px each row is two lines instead of a strip of columns.
	 */
	let { data }: PageProps = $props();

	const campaign = $derived(data.campaign);
	const values = $derived(data.filters);
	const pagination = $derived(data.pagination);
	const listHref = $derived(resolve('/campaigns/[id]/sales', { id: campaign.id }));
	const saleHref = (saleId: string) =>
		resolve('/campaigns/[id]/sales/[saleId]', { id: campaign.id, saleId });
	const numbering = $derived(campaignNumberingConfig(campaign));
	const filtered = $derived(Object.values(values).some(Boolean));

	const rows = $derived(
		data.sales.map((item) => ({
			id: item.sale.id,
			// A pata is sold as one sale: its numbers are read together, as on the bonds list.
			numbers: item.bondNumberPairs
				.map((pair) => formatCampaignNumber(pair.base, numbering))
				.join(' + '),
			associated: item.bondNumberPairs
				.filter((pair) => pair.associated !== null)
				.map((pair) => formatCampaignNumber(pair.associated!, numbering))
				.join(' + '),
			buyerName: item.buyerName,
			collectorName: item.collectorName,
			collectorId: item.sale.collectorId,
			soldAt: item.sale.soldAt,
			total: item.sale.totalAmount,
			status: item.sale.status,
			financialStatus: item.financialStatus
		}))
	);
	type Row = (typeof rows)[number];
	const columns: TableColumn<Row>[] = [
		{ key: 'bond', header: 'Bono', stack: 'primary' },
		{ key: 'buyer', header: 'Comprador', stack: 'hidden' },
		{ key: 'status', header: 'Pagos', stack: 'trailing' },
		{ key: 'collector', header: 'Cobrador', stack: 'secondary' },
		{ key: 'associated', header: 'Número asociado', stack: 'hidden' },
		{ key: 'soldAt', header: 'Fecha', stack: 'hidden' },
		{ key: 'total', header: 'Total', align: 'right', stack: 'hidden' }
	];

	const anyOption = [{ value: '', label: 'Cualquiera' }];
	/**
	 * The collector filter can arrive from a link with a collector that is not among the active ones
	 * (deactivated since). Every row of that list is theirs, so the name comes from one of them.
	 */
	const filteredCollectorName = $derived.by(() => {
		if (!values.collector) return null;
		const option = data.collectors.find((collector) => collector.id === values.collector);
		if (option) return option.displayName;
		const row = rows.find((candidate) => candidate.collectorId === values.collector);
		return row && isReadableName(row.collectorName) ? row.collectorName : null;
	});
	const collectorOptions = $derived([
		{ value: '', label: 'Todos' },
		...data.collectors.map((collector) => ({ value: collector.id, label: collector.displayName })),
		...(filteredCollectorName &&
		!data.collectors.some((collector) => collector.id === values.collector)
			? [{ value: values.collector, label: filteredCollectorName }]
			: [])
	]);
	const modeOptions = [
		...anyOption,
		...Object.entries(PAYMENT_MODE_LABELS).map(([value, label]) => ({ value, label }))
	];
	const financialOptions = [
		...anyOption,
		...FINANCIAL_STATUSES.map((status) => ({
			value: status,
			label: statusMeta('bondFinancial', status).label
		}))
	];
	const optionLabel = (options: { value: string; label: string }[], value: string) =>
		options.find((option) => option.value === value)?.label ?? value;

	/** The folded filters that are applied, as chips; each links to the list without it. */
	const applied = $derived<AppliedFilter[]>(
		[
			values.collector && {
				key: 'collector',
				label: filteredCollectorName ? `Cobrador: ${filteredCollectorName}` : 'Cobrador'
			},
			values.paymentMode && {
				key: 'paymentMode',
				label: `Modalidad: ${optionLabel(modeOptions, values.paymentMode)}`
			},
			values.financialStatus && {
				key: 'financialStatus',
				label: `Pagos: ${optionLabel(financialOptions, values.financialStatus)}`
			}
		]
			.filter((chip) => !!chip)
			.map((chip) => ({
				label: chip.label,
				removeHref: listUrl(listHref, values, { without: chip.key })
			}))
	);
</script>

<svelte:head>
	<title>Ventas - {campaign.name} - {institutionName()}</title>
</svelte:head>

<PageHeader
	title="Ventas"
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: campaign.name, href: resolve('/campaigns/[id]', { id: campaign.id }) },
		{ label: 'Ventas' }
	]}
>
	{#snippet actions()}
		{#if data.can.create}
			<Button
				variant="primary"
				icon="plus"
				href={resolve('/campaigns/[id]/sales/new', { id: campaign.id })}>Registrar venta</Button
			>
		{/if}
	{/snippet}
</PageHeader>

<div class="flex flex-col gap-6">
	<FilterBar
		action={listHref}
		searchName="buyer"
		searchLabel="Nombre del comprador"
		searchValue={values.buyer}
		{applied}
		clearHref={filtered ? listHref : undefined}
	>
		{#snippet filters()}
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
				<Field label="Cobrador" id="filter-collector">
					<Select name="collector" value={values.collector} options={collectorOptions} />
				</Field>
				<Field label="Modalidad" id="filter-payment-mode">
					<Select name="paymentMode" value={values.paymentMode} options={modeOptions} />
				</Field>
				<Field label="Pagos" id="filter-financial-status">
					<Select
						name="financialStatus"
						value={values.financialStatus}
						options={financialOptions}
					/>
				</Field>
			</div>
		{/snippet}
	</FilterBar>

	<section aria-labelledby="results-title" class="flex flex-col gap-3">
		<h2 id="results-title" class="sr-only">Resultados</h2>
		{#if pagination.total === 0}
			<EmptyState
				title={filtered ? 'Ninguna venta coincide con los filtros' : 'Todavía no hay ventas'}
				icon={filtered ? 'search' : 'inbox'}
			>
				{filtered
					? 'Probar con otros filtros o quitarlos para ver todas las ventas.'
					: 'Una venta se registra con un bono que ya tiene un cobrador y el comprador que lo lleva.'}
			</EmptyState>
		{:else if rows.length === 0}
			<EmptyState title="No hay ventas en esta página" icon="search">
				<a
					href={listUrl(listHref, values)}
					class="text-primary-text underline-offset-2 hover:underline">Ir a la primera página</a
				>
			</EmptyState>
		{:else}
			<p class="m-0 text-body-sm text-muted" aria-live="polite">
				{showingRange(pagination, { one: 'venta', many: 'ventas' })}
			</p>
			<Table {columns} {rows} caption="Ventas de la campaña" density="compact" stack>
				{#snippet cell({ row, column })}
					{#if column.key === 'bond'}
						<!-- On a phone the buyer follows the number and wraps beside it; the numbers of a long
						     pata may wrap too (`BondNumber` alone never breaks). -->
						<span
							data-sale-id={row.id}
							class="flex flex-wrap items-baseline gap-x-2 max-[719px]:[&_[data-bond-number]]:flex-wrap max-[719px]:[&_[data-bond-number]]:whitespace-normal"
						>
							{#if row.numbers}
								<BondNumber number={row.numbers} size="sm" href={saleHref(row.id)} />
							{:else}
								<a
									href={saleHref(row.id)}
									class="font-medium text-primary-text underline underline-offset-2">Ver venta</a
								>
							{/if}
							<span
								class="min-w-0 flex-1 basis-32 break-words min-[720px]:hidden"
								class:text-muted={!isReadableName(row.buyerName)}>{row.buyerName}</span
							>
						</span>
					{:else if column.key === 'buyer'}
						<span class:text-muted={!isReadableName(row.buyerName)}>{row.buyerName}</span>
					{:else if column.key === 'status'}
						{#if row.status === 'active'}
							<StatusBadge kind="bondFinancial" status={row.financialStatus} />
						{:else}
							<StatusBadge kind="sale" status={row.status} />
						{/if}
					{:else if column.key === 'collector'}
						<span
							class="max-[719px]:flex max-[719px]:items-baseline max-[719px]:justify-between max-[719px]:gap-3"
						>
							<span class="break-words max-[719px]:min-w-0">
								{#if isReadableName(row.collectorName)}
									<span class="min-[720px]:hidden">Lo cobra</span>
									{row.collectorName}
								{:else}
									<span class="text-muted">{row.collectorName}</span>
								{/if}
							</span>
							<Money value={row.total} class="text-text min-[720px]:hidden" />
						</span>
					{:else if column.key === 'associated'}
						<span class="font-mono tabular-nums text-muted">{row.associated || '—'}</span>
					{:else if column.key === 'soldAt'}
						<span class="whitespace-nowrap tabular-nums">{formatDate(row.soldAt)}</span>
					{:else if column.key === 'total'}
						<Money value={row.total} />
					{/if}
				{/snippet}
			</Table>
		{/if}

		{#if pagination.pageCount > 1 || pagination.page > 1}
			<nav aria-label="Paginación" class="flex items-center justify-between gap-3 text-body-sm">
				{#if pagination.page > 1}
					<Button href={listUrl(listHref, values, { page: pagination.page - 1 })} rel="prev"
						>Anterior</Button
					>
				{:else}
					<span></span>
				{/if}
				<span class="text-muted tabular-nums"
					>Página {formatNumber(pagination.page)} de {formatNumber(pagination.pageCount)}</span
				>
				{#if pagination.page < pagination.pageCount}
					<Button href={listUrl(listHref, values, { page: pagination.page + 1 })} rel="next"
						>Siguiente</Button
					>
				{:else}
					<span></span>
				{/if}
			</nav>
		{/if}
	</section>
</div>

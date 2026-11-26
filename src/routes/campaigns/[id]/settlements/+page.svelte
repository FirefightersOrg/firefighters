<script lang="ts">
	import { institutionName } from '$lib/institution';
	import { resolve } from '$app/paths';
	import {
		Button,
		EmptyState,
		Field,
		FilterBar,
		Money,
		PageHeader,
		Select,
		StatusBadge,
		Table,
		TextInput,
		type AppliedFilter,
		type TableColumn
	} from '$lib/components/ui';
	import { isReadableName } from '$lib/domain/parties';
	import { SETTLEMENT_STATUS_LABELS, SETTLEMENT_STATUSES } from '$lib/domain/payments';
	import { formatDate, formatNumber } from '$lib/format';
	import { listUrl } from '$lib/list-query';
	import type { PageProps } from './$types';

	/**
	 * Settlements list (UX plan PR 14, audit A7 and A9). The open ones come first (the repository
	 * orders them), and a row says «Rendición 15 de Héctor Acosta», its state and, once closed, its
	 * total. GET filters, folded; the list has no text search, so `FilterBar` is used without one. Below 720px each row is two lines.
	 */
	let { data }: PageProps = $props();

	const campaign = $derived(data.campaign);
	const values = $derived(data.filters);
	const listHref = $derived(resolve('/campaigns/[id]/settlements', { id: campaign.id }));
	const settlementHref = (settlementId: string) =>
		resolve('/campaigns/[id]/settlements/[settlementId]', { id: campaign.id, settlementId });
	const filtered = $derived(Object.values(values).some(Boolean));

	type Row = (typeof data.settlements)[number];
	const columns: TableColumn<Row>[] = [
		{ key: 'number', header: 'Rendición', stack: 'primary' },
		{ key: 'collector', header: 'Cobrador', stack: 'hidden' },
		{ key: 'status', header: 'Estado', stack: 'trailing' },
		{ key: 'openedAt', header: 'Apertura', stack: 'secondary' },
		{ key: 'closedAt', header: 'Cierre', stack: 'hidden' },
		{ key: 'total', header: 'Total', align: 'right', stack: 'hidden' }
	];
	const rows = $derived(data.settlements);
	const openCount = $derived(rows.filter((row) => row.status === 'open').length);
	/** «16 rendiciones, 3 abiertas». The open ones are not counted apart when the list is only them. */
	const counted = $derived(
		`${formatNumber(rows.length)} ${rows.length === 1 ? 'rendición' : 'rendiciones'}` +
			(openCount > 0 && openCount < rows.length
				? `, ${formatNumber(openCount)} ${openCount === 1 ? 'abierta' : 'abiertas'}`
				: '')
	);

	const collectorName = (id: string) =>
		data.collectors.find((collector) => collector.id === id)?.displayName ??
		rows.find((row) => row.collectorId === id && isReadableName(row.collectorName))?.collectorName;
	const collectorOptions = $derived([
		{ value: '', label: 'Todos' },
		...data.collectors.map((collector) => ({ value: collector.id, label: collector.displayName })),
		// A collector that is no longer active, reached from a link: kept as the chosen option.
		...(values.collector &&
		!data.collectors.some((collector) => collector.id === values.collector) &&
		collectorName(values.collector)
			? [{ value: values.collector, label: collectorName(values.collector)! }]
			: [])
	]);
	const statusOptions = [
		{ value: '', label: 'Cualquiera' },
		...SETTLEMENT_STATUSES.map((status) => ({
			value: status,
			label: SETTLEMENT_STATUS_LABELS[status]
		}))
	];

	/** The filters that are applied, as chips; each links to the list without it. */
	const applied = $derived<AppliedFilter[]>(
		[
			values.collector && {
				key: 'collector',
				label: collectorName(values.collector)
					? `Cobrador: ${collectorName(values.collector)}`
					: 'Cobrador'
			},
			values.status && {
				key: 'status',
				label: `Estado: ${
					statusOptions.find((option) => option.value === values.status)?.label ?? values.status
				}`
			},
			values.from && { key: 'from', label: `Abierta desde: ${formatDate(values.from)}` },
			values.to && { key: 'to', label: `Abierta hasta: ${formatDate(values.to)}` }
		]
			.filter((chip) => !!chip)
			.map((chip) => ({
				label: chip.label,
				removeHref: listUrl(listHref, values, { without: chip.key })
			}))
	);
</script>

<svelte:head>
	<title>Rendiciones - {campaign.name} - {institutionName()}</title>
</svelte:head>

<PageHeader
	title="Rendiciones"
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: campaign.name, href: resolve('/campaigns/[id]', { id: campaign.id }) },
		{ label: 'Rendiciones' }
	]}
>
	{#snippet actions()}
		{#if data.can.create}
			<Button
				variant="primary"
				icon="plus"
				href={resolve('/campaigns/[id]/settlements/new', { id: campaign.id })}
				>Abrir rendición</Button
			>
		{/if}
	{/snippet}
</PageHeader>

<div class="flex flex-col gap-6">
	<FilterBar action={listHref} {applied} clearHref={listHref}>
		{#snippet filters()}
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<Field label="Cobrador" id="filter-collector">
					<Select name="collector" value={values.collector} options={collectorOptions} />
				</Field>
				<Field label="Estado" id="filter-status">
					<Select name="status" value={values.status} options={statusOptions} />
				</Field>
				<Field label="Abierta desde" id="filter-from">
					<TextInput type="date" name="from" value={values.from} />
				</Field>
				<Field label="Abierta hasta" id="filter-to">
					<TextInput type="date" name="to" value={values.to} />
				</Field>
			</div>
		{/snippet}
	</FilterBar>

	<section aria-labelledby="results-title" class="flex flex-col gap-3">
		<h2 id="results-title" class="sr-only">Resultados</h2>
		{#if rows.length === 0}
			<EmptyState
				title={filtered
					? 'Ninguna rendición coincide con los filtros'
					: 'Todavía no hay rendiciones'}
				icon={filtered ? 'search' : 'inbox'}
			>
				{filtered
					? 'Probar con otros filtros o quitarlos para ver todas las rendiciones.'
					: 'Abrir una rendición para cargar los pagos que entrega un cobrador.'}
			</EmptyState>
		{:else}
			<p class="m-0 text-body-sm text-muted" aria-live="polite">{counted}</p>
			<Table {columns} {rows} caption="Rendiciones de la campaña" density="compact" stack>
				{#snippet cell({ row, column })}
					{#if column.key === 'number'}
						<!-- The link stays inline so the collector's name wraps after it like a sentence; on a
						     phone its padding makes it a 44px target without making the line taller. -->
						<span data-settlement-id={row.id} class="break-words">
							<a
								href={settlementHref(row.id)}
								class="rounded-sm font-medium whitespace-nowrap text-primary-text underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus max-[719px]:py-3.5"
								>Rendición {formatNumber(row.settlementNumber)}</a
							>{#if isReadableName(row.collectorName)}<span class="min-[720px]:hidden"
									>{` de ${row.collectorName}`}</span
								>{/if}
						</span>
					{:else if column.key === 'collector'}
						<span class:text-muted={!isReadableName(row.collectorName)}>{row.collectorName}</span>
					{:else if column.key === 'status'}
						<StatusBadge kind="settlement" status={row.status} />
					{:else if column.key === 'openedAt'}
						<span
							class="max-[719px]:flex max-[719px]:items-baseline max-[719px]:justify-between max-[719px]:gap-3"
						>
							<span class="whitespace-nowrap tabular-nums">
								{#if row.closedAt}
									<span class="min-[720px]:hidden">Cerrada el {formatDate(row.closedAt)}</span>
								{:else}
									<span class="min-[720px]:hidden">Abierta el {formatDate(row.openedAt)}</span>
								{/if}
								<span class="max-[719px]:hidden">{formatDate(row.openedAt)}</span>
							</span>
							{#if row.status !== 'open'}
								<Money value={row.totals.totalAmount} class="text-text min-[720px]:hidden" />
							{/if}
						</span>
					{:else if column.key === 'closedAt'}
						<span class="whitespace-nowrap tabular-nums">{formatDate(row.closedAt)}</span>
					{:else if column.key === 'total'}
						{#if row.status === 'open'}
							<span class="text-muted">—<span class="sr-only"> (se calcula al cerrar)</span></span>
						{:else}
							<Money value={row.totals.totalAmount} />
						{/if}
					{/if}
				{/snippet}
			</Table>
		{/if}
	</section>
</div>

<script lang="ts">
	import { institutionName } from '$lib/institution';
	import { resolve } from '$app/paths';
	import {
		Button,
		EmptyState,
		Field,
		FilterBar,
		PageHeader,
		Select,
		StatusBadge,
		Table,
		TextInput,
		type AppliedFilter,
		type TableColumn
	} from '$lib/components/ui';
	import {
		DELIVERY_NOTE_REASON_LABELS,
		deliveryNoteLabel,
		deliveryNoteParty
	} from '$lib/domain/deliveries';
	import { NO_ACCESS_COLLECTOR } from '$lib/domain/parties';
	import { formatDate, formatDateTime, formatNumber } from '$lib/format';
	import { listUrl, showingRange } from '$lib/list-query';
	import type { PageProps } from './$types';

	/**
	 * Delivery notes list (UX plan PR 14, audit A7). A row says the note as it is said, «Remito 0007
	 * a Jorge Medina», how many bonds it carries and whether it was a delivery, a reassignment or a
	 * return. The note number is the search; the other filters are folded. GET filters, server-side
	 * pages. Below 720px each row is two lines instead of a strip of columns.
	 */
	let { data }: PageProps = $props();

	const campaign = $derived(data.campaign);
	const values = $derived({
		collector: data.filters.collector ?? '',
		number: data.filters.number ?? '',
		from: data.filters.from ?? '',
		to: data.filters.to ?? ''
	});
	const pagination = $derived(data.pagination);
	const listHref = $derived(resolve('/campaigns/[id]/deliveries', { id: campaign.id }));
	const noteHref = (noteId: string) =>
		resolve('/campaigns/[id]/deliveries/[noteId]', { id: campaign.id, noteId });
	const filtered = $derived(Object.values(values).some(Boolean));

	type Row = (typeof data.notes)[number] & Record<string, unknown>;
	const columns: TableColumn<Row>[] = [
		{ key: 'note', header: 'Remito', stack: 'primary' },
		{ key: 'collector', header: 'Cobrador', stack: 'hidden' },
		{ key: 'reason', header: 'Motivo', stack: 'secondary' },
		{ key: 'issuedAt', header: 'Fecha', stack: 'hidden' },
		{ key: 'createdBy', header: 'Emitido por', stack: 'hidden' },
		{ key: 'bondCount', header: 'Bonos', align: 'right', stack: 'trailing' }
	];
	const rows = $derived(data.notes as Row[]);

	const collectorName = (id: string) =>
		data.collectors.find((collector) => collector.id === id)?.displayName ??
		rows.find((row) => row.collectorId === id && row.collectorName)?.collectorName;
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

	/** The folded filters that are applied, as chips; each links to the list without it. */
	const applied = $derived<AppliedFilter[]>(
		[
			values.collector && {
				key: 'collector',
				label: collectorName(values.collector)
					? `Cobrador: ${collectorName(values.collector)}`
					: 'Cobrador'
			},
			values.from && { key: 'from', label: `Emitido desde: ${formatDate(values.from)}` },
			values.to && { key: 'to', label: `Emitido hasta: ${formatDate(values.to)}` }
		]
			.filter((chip) => !!chip)
			.map((chip) => ({
				label: chip.label,
				removeHref: listUrl(listHref, values, { without: chip.key })
			}))
	);
</script>

<svelte:head><title>Remitos de entrega - {campaign.name} - {institutionName()}</title></svelte:head>

<PageHeader
	title="Remitos de entrega"
	description="Entregas, reasignaciones y devoluciones de bonos a los cobradores."
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: campaign.name, href: resolve('/campaigns/[id]', { id: campaign.id }) },
		{ label: 'Entregas' }
	]}
>
	{#snippet actions()}
		{#if data.can.deliver}
			<Button
				variant="primary"
				icon="plus"
				href={resolve('/campaigns/[id]/deliveries/new', { id: campaign.id })}>Nueva entrega</Button
			>
		{/if}
	{/snippet}
</PageHeader>

<div class="flex flex-col gap-6">
	<FilterBar
		action={listHref}
		searchName="number"
		searchLabel="Número de remito"
		searchValue={values.number}
		inputmode="numeric"
		{applied}
		clearHref={filtered ? listHref : undefined}
	>
		{#snippet filters()}
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
				<Field label="Cobrador" id="filter-collector">
					<Select name="collector" value={values.collector} options={collectorOptions} />
				</Field>
				<Field label="Emitido desde" id="filter-from">
					<TextInput name="from" type="date" value={values.from} />
				</Field>
				<Field label="Emitido hasta" id="filter-to">
					<TextInput name="to" type="date" value={values.to} />
				</Field>
			</div>
		{/snippet}
	</FilterBar>

	<section aria-labelledby="results-title" class="flex flex-col gap-3">
		<h2 id="results-title" class="sr-only">Resultados</h2>
		{#if rows.length === 0 && !(pagination.total > 0)}
			<EmptyState
				title={filtered ? 'Ningún remito coincide con los filtros' : 'Todavía no hay remitos'}
				icon={filtered ? 'search' : 'inbox'}
			>
				{filtered
					? 'Probar con otros filtros o quitarlos para ver todos los remitos.'
					: 'Un remito se emite al entregar bonos a un cobrador, al reasignarlos o al recibirlos de vuelta.'}
			</EmptyState>
		{:else if rows.length === 0}
			<EmptyState title="No hay remitos en esta página" icon="search">
				<a
					href={listUrl(listHref, values)}
					class="text-primary-text underline-offset-2 hover:underline">Ir a la primera página</a
				>
			</EmptyState>
		{:else}
			<p class="m-0 text-body-sm text-muted" aria-live="polite">
				{showingRange(pagination, { one: 'remito', many: 'remitos' })}
			</p>
			<Table {columns} {rows} caption="Remitos de la campaña" density="compact" stack>
				{#snippet cell({ row, column })}
					{#if column.key === 'note'}
						<!-- The link stays inline so the collector's name wraps after it like a sentence; on a
						     phone its padding makes it a 44px target without making the line taller. -->
						<span data-note-id={row.id} class="break-words">
							<a
								href={noteHref(row.id)}
								class="rounded-sm font-medium whitespace-nowrap text-primary-text underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus max-[719px]:py-3.5"
								>{deliveryNoteLabel(row.noteNumber)}</a
							>{#if row.collectorName}<span class="min-[720px]:hidden"
									>{` ${deliveryNoteParty(row.reason, row.collectorName)}`}</span
								>{/if}
						</span>
					{:else if column.key === 'collector'}
						{#if row.collectorName}
							{row.collectorName}
						{:else}
							<span class="text-muted">{NO_ACCESS_COLLECTOR}</span>
						{/if}
					{:else if column.key === 'bondCount'}
						<span class="whitespace-nowrap"
							>{formatNumber(row.bondCount)}<span class="min-[720px]:hidden"
								>{row.bondCount === 1 ? ' bono' : ' bonos'}</span
							></span
						>
					{:else if column.key === 'reason'}
						<span class="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
							<span
								>{DELIVERY_NOTE_REASON_LABELS[row.reason]}<span class="min-[720px]:hidden"
									>{` del ${formatDate(row.issuedAt)}`}</span
								></span
							>
							{#if row.status === 'annulled'}
								<StatusBadge kind="deliveryNote" status={row.status} />
							{/if}
						</span>
					{:else if column.key === 'issuedAt'}
						<span class="whitespace-nowrap tabular-nums">{formatDateTime(row.issuedAt)}</span>
					{:else if column.key === 'createdBy'}
						{row.createdByName ?? '—'}
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

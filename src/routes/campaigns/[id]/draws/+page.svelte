<script lang="ts">
	import { institutionName } from '$lib/institution';
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import {
		Button,
		EmptyState,
		Field,
		FilterBar,
		PageHeader,
		Select,
		StatusBadge,
		Table,
		type AppliedFilter,
		type TableColumn
	} from '$lib/components/ui';
	import {
		DRAW_STATUSES,
		DRAW_STATUS_LABELS,
		DRAW_TYPES,
		DRAW_TYPE_LABELS,
		type DrawStatus,
		type DrawType
	} from '$lib/domain/draws';
	import { listSearch, splitDraws } from '$lib/domain/people-draw-lists';
	import { formatDate, formatDateTime } from '$lib/format';
	import type { PageProps } from './$types';

	/**
	 * Draws list (UX plan PR 14b, audit A7): a short calendar. The draws still to be held come first,
	 * the next one on top; the ones already held or annulled follow, the latest on top. Each row is
	 * the draw, its state (which says whether the roster is generated or frozen), its date and the
	 * payment cutoff. The two filters are folded and live in the query string. Below 720px each row is
	 * a block of lines instead of a strip of columns.
	 */
	let { data }: PageProps = $props();

	const campaign = $derived(data.campaign);
	const listHref = $derived(resolve('/campaigns/[id]/draws', { id: campaign.id }));
	/** Only the values the load filters by: an unknown value in the URL is not a filter. */
	const type = $derived(
		DRAW_TYPES.includes(data.filters.type as DrawType) ? (data.filters.type as DrawType) : ''
	);
	const status = $derived(
		DRAW_STATUSES.includes(data.filters.status as DrawStatus)
			? (data.filters.status as DrawStatus)
			: ''
	);
	const filtered = $derived(Boolean(type || status));
	/** The pathname is `resolve()`d; only a search string is appended (hence the cast). */
	const link = (values: Record<string, string>) =>
		`${listHref}${listSearch(values)}` as ResolvedPathname;
	const applied = $derived<AppliedFilter[]>([
		...(type ? [{ label: `Tipo: ${DRAW_TYPE_LABELS[type]}`, removeHref: link({ status }) }] : []),
		...(status
			? [{ label: `Estado: ${DRAW_STATUS_LABELS[status]}`, removeHref: link({ type }) }]
			: [])
	]);

	type Row = (typeof data.draws)[number] & Record<string, unknown>;
	const calendar = $derived(splitDraws(data.draws as Row[]));
	const columns: TableColumn<Row>[] = [
		{ key: 'name', header: 'Sorteo', stack: 'primary' },
		{ key: 'status', header: 'Estado', stack: 'trailing' },
		{ key: 'date', header: 'Fecha' },
		{ key: 'cutoff', header: 'Corte de pagos' },
		{ key: 'type', header: 'Tipo', stack: 'hidden' }
	];
	const typeOptions = [
		{ value: '', label: 'Cualquiera' },
		...DRAW_TYPES.map((value) => ({ value, label: DRAW_TYPE_LABELS[value] }))
	];
	const statusOptions = [
		{ value: '', label: 'Cualquiera' },
		...DRAW_STATUSES.map((value) => ({ value, label: DRAW_STATUS_LABELS[value] }))
	];
</script>

<svelte:head><title>Sorteos - {campaign.name} - {institutionName()}</title></svelte:head>

<PageHeader
	title="Sorteos"
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: campaign.name, href: resolve('/campaigns/[id]', { id: campaign.id }) },
		{ label: 'Sorteos' }
	]}
>
	{#snippet actions()}
		{#if data.can.create}
			<Button
				variant="primary"
				icon="plus"
				href={resolve('/campaigns/[id]/draws/new', { id: campaign.id })}>Nuevo sorteo</Button
			>
		{/if}
	{/snippet}
</PageHeader>

{#snippet list(caption: string, rows: Row[])}
	<Table {columns} {rows} {caption} stack>
		{#snippet cell({ row, column })}
			{#if column.key === 'name'}
				<a
					data-draw-id={row.id}
					href={resolve('/campaigns/[id]/draws/[drawId]', { id: campaign.id, drawId: row.id })}
					class="inline-flex min-h-touch items-center rounded-sm font-medium text-primary-text underline-offset-2 [overflow-wrap:anywhere] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus min-[720px]:min-h-0"
					>{row.name}</a
				>
			{:else if column.key === 'status'}
				<span class="inline-flex min-h-touch items-center min-[720px]:min-h-0"
					><StatusBadge kind="draw" status={row.status} /></span
				>
			{:else if column.key === 'date'}
				<span class="whitespace-nowrap tabular-nums">{formatDate(row.drawDate)}</span>
			{:else if column.key === 'cutoff'}
				<span class="whitespace-nowrap tabular-nums">{formatDateTime(row.paymentCutoffAt)}</span>
			{:else if column.key === 'type'}
				{DRAW_TYPE_LABELS[row.drawType]}
			{/if}
		{/snippet}
	</Table>
{/snippet}

<div class="flex flex-col gap-6">
	<FilterBar action={listHref} {applied} clearHref={listHref}>
		{#snippet filters()}
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
				<Field label="Tipo" id="filter-type">
					<Select name="type" options={typeOptions} value={type} />
				</Field>
				<Field label="Estado" id="filter-status">
					<Select name="status" options={statusOptions} value={status} />
				</Field>
			</div>
		{/snippet}
	</FilterBar>

	<section aria-labelledby="results-title" class="flex flex-col gap-6">
		<h2 id="results-title" class="sr-only">Resultados</h2>
		{#if data.draws.length === 0}
			<EmptyState
				title={filtered ? 'Ningún sorteo coincide con los filtros' : 'Todavía no hay sorteos'}
				icon={filtered ? 'search' : 'inbox'}
			>
				{#if filtered}
					Probar con otro tipo u otro estado.
				{:else if data.can.create}
					Crear el primero con «Nuevo sorteo».
				{:else}
					Los crea quien administra la campaña.
				{/if}
				{#snippet actions()}
					{#if filtered}<Button href={listHref}>Ver todos los sorteos</Button>{/if}
				{/snippet}
			</EmptyState>
		{:else}
			{#if calendar.pending.length}
				{@render list('Sorteos por realizar', calendar.pending)}
			{:else if !filtered}
				<p class="m-0 text-body-sm text-muted" data-no-pending-draws>
					No queda ningún sorteo por realizar.
				</p>
			{/if}
			{#if calendar.done.length}
				{@render list('Sorteos realizados o anulados', calendar.done)}
			{/if}
		{/if}
	</section>
</div>

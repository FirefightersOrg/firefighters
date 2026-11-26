<script lang="ts">
	import { institutionName } from '$lib/institution';
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import Pagination from '$lib/components/layout/Pagination.svelte';
	import {
		Button,
		EmptyState,
		Field,
		FilterBar,
		PageHeader,
		Select,
		Table,
		type AppliedFilter,
		type TableColumn
	} from '$lib/components/ui';
	import {
		buyerDisplayName,
		buyerIdentification,
		BUYER_TYPE_LABELS,
		BUYER_TYPES,
		NO_ACCESS_COLLECTOR
	} from '$lib/domain/parties';
	import {
		bondCountWords,
		dialNumber,
		listSearch,
		showingWords
	} from '$lib/domain/people-draw-lists';
	import { formatNumber } from '$lib/format';
	import type { PageProps } from './$types';

	/**
	 * Buyers list (UX plan PR 14b, audit A7): where a person is found by name, phone or document
	 * before a sale or a call. The search first, the type filter folded; each row is the name, the
	 * phone (a `tel:` link) and how many bonds of this campaign the buyer has. GET filters (they live
	 * in the query string), server-side pages. Below 720px each row is a block of two lines instead of
	 * a strip of columns.
	 */
	let { data }: PageProps = $props();

	const campaign = $derived(data.campaign);
	const pagination = $derived(data.pagination);
	const listHref = $derived(resolve('/campaigns/[id]/buyers', { id: campaign.id }));
	const filtered = $derived(Boolean(data.query.q || data.query.type));
	/**
	 * This list with some filters, at a page. The pathname is `resolve()`d; only a search string is
	 * appended, which `ResolvedPathname` does not model (hence the cast).
	 */
	const link = (values: Record<string, string>, page = 1) =>
		`${listHref}${listSearch(values, page)}` as ResolvedPathname;
	const pageLink = (page: number) => link(data.query, page);
	const recordHref = (buyerId: string) =>
		resolve('/campaigns/[id]/buyers/[buyerId]', { id: campaign.id, buyerId });
	/** The usual collector's name; the Spanish fallback when the role cannot read that collector. */
	const usualCollector = (id: string | null) =>
		id ? (data.collectors.find((c) => c.id === id)?.displayName ?? NO_ACCESS_COLLECTOR) : '—';

	type Row = (typeof data.buyers)[number] & Record<string, unknown>;
	const rows = $derived(data.buyers as Row[]);
	const columns = $derived<TableColumn<Row>[]>([
		{ key: 'name', header: 'Comprador', stack: 'primary' },
		{ key: 'phone', header: 'Teléfono', stack: 'trailing' },
		...(data.can.bondCounts
			? [
					{
						key: 'bonds',
						header: 'Bonos en esta campaña',
						align: 'right',
						stack: 'secondary'
					} as const
				]
			: []),
		{ key: 'type', header: 'Tipo', stack: 'hidden' },
		{ key: 'identification', header: 'Identificación', mono: true, stack: 'hidden' },
		{ key: 'usualCollector', header: 'Cobrador habitual', stack: 'hidden' }
	]);
	const typeOptions = [
		{ value: '', label: 'Cualquiera' },
		{ value: 'individual', label: BUYER_TYPE_LABELS.individual },
		{ value: 'business', label: BUYER_TYPE_LABELS.business }
	];
	const type = $derived(BUYER_TYPES.find((value) => value === data.query.type));
	const applied = $derived<AppliedFilter[]>(
		type
			? [{ label: `Tipo: ${BUYER_TYPE_LABELS[type]}`, removeHref: link({ q: data.query.q }) }]
			: []
	);
</script>

<svelte:head><title>Compradores - {campaign.name} - {institutionName()}</title></svelte:head>

<PageHeader
	title="Compradores"
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: campaign.name, href: resolve('/campaigns/[id]', { id: campaign.id }) },
		{ label: 'Compradores' }
	]}
>
	{#snippet actions()}
		{#if data.can.manage}
			<Button
				variant="primary"
				icon="plus"
				href={resolve('/campaigns/[id]/buyers/new', { id: campaign.id })}
			>
				Nuevo comprador
			</Button>
		{/if}
	{/snippet}
</PageHeader>

<div class="flex flex-col gap-6">
	<FilterBar
		action={listHref}
		searchName="q"
		searchLabel="Nombre, teléfono o documento"
		searchValue={data.query.q}
		{applied}
		clearHref={filtered ? listHref : undefined}
	>
		{#snippet filters()}
			<Field label="Tipo" id="filter-type">
				<Select name="type" value={data.query.type} options={typeOptions} />
			</Field>
		{/snippet}
	</FilterBar>

	<section aria-labelledby="results-title" class="flex flex-col gap-3">
		<h2 id="results-title" class="sr-only">Resultados</h2>
		{#if pagination.total === 0}
			<EmptyState
				title={filtered
					? 'Ningún comprador coincide con la búsqueda'
					: 'Todavía no hay compradores'}
				icon={filtered ? 'search' : 'inbox'}
			>
				{#if filtered}
					Probar con otro nombre, teléfono o documento.
				{:else if data.can.manage}
					Se cargan al registrar una venta, o antes con «Nuevo comprador».
				{:else}
					Se cargan al registrar una venta.
				{/if}
				{#snippet actions()}
					{#if filtered}<Button href={listHref}>Ver todos los compradores</Button>{/if}
				{/snippet}
			</EmptyState>
		{:else if rows.length === 0}
			<EmptyState title="No hay compradores en esta página" icon="search">
				<a href={pageLink(1)} class="text-primary-text underline-offset-2 hover:underline"
					>Ir a la primera página</a
				>
			</EmptyState>
		{:else}
			<p class="m-0 text-body-sm text-muted" aria-live="polite">
				{showingWords(pagination, { one: 'comprador', many: 'compradores' })}
			</p>
			<Table
				{columns}
				{rows}
				caption={data.can.bondCounts ? 'Bonos en esta campaña' : 'Compradores'}
				stack
			>
				{#snippet cell({ row, column })}
					{#if column.key === 'name'}
						<a
							data-buyer-id={row.id}
							href={recordHref(row.id)}
							class="inline-flex min-h-touch items-center rounded-sm font-medium text-primary-text underline-offset-2 [overflow-wrap:anywhere] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus min-[720px]:min-h-0"
							>{buyerDisplayName(row)}</a
						>
					{:else if column.key === 'phone'}
						{@const tel = dialNumber(row.phone)}
						{#if tel}
							<a
								href="tel:{tel}"
								class="inline-flex min-h-touch items-center rounded-sm text-body-sm whitespace-nowrap text-primary-text underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus min-[720px]:min-h-0"
								>{row.phone}</a
							>
						{:else}
							<span class="max-[719px]:hidden">{row.phone ?? '—'}</span>
						{/if}
					{:else if column.key === 'bonds'}
						<span class="max-[719px]:hidden">{formatNumber(row.bondCount ?? 0)}</span>
						<span class="min-[720px]:hidden">{bondCountWords(row.bondCount ?? 0)}</span>
					{:else if column.key === 'type'}
						{BUYER_TYPE_LABELS[row.type]}
					{:else if column.key === 'identification'}
						{buyerIdentification(row) ?? '—'}
					{:else if column.key === 'usualCollector'}
						{usualCollector(row.usualCollectorId)}
					{/if}
				{/snippet}
			</Table>
		{/if}

		<Pagination page={pagination.page} pageCount={pagination.pageCount} hrefFor={pageLink} />
	</section>
</div>

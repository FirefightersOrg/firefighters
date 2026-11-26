<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import {
		Badge,
		BondNumber,
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
	import { formatNumber } from '$lib/format';
	import type { PageProps } from './$types';

	/**
	 * Roster of a draw (UX plan PR 16): every participating number with who bought it, who collects
	 * it and whether it is eligible. Below 720px each number is a block of lines instead of a strip
	 * of columns. A frozen roster leads on to the winners with a button; a generated one says that it
	 * can still change and where it is frozen.
	 */
	let { data }: PageProps = $props();

	type Entry = (typeof data.entries)[number] & Record<string, unknown>;
	const columns: TableColumn<Entry>[] = [
		{ key: 'formattedNumber', header: 'Número', stack: 'primary' },
		{ key: 'buyerName', header: 'Comprador', stack: 'secondary' },
		{ key: 'collectorName', header: 'Cobrador', stack: 'hidden' },
		{ key: 'eligibility', header: 'Elegibilidad', stack: 'trailing' },
		{ key: 'reason', header: 'Motivo', stack: 'secondary' },
		{ key: 'bondLabel', header: 'Código interno', mono: true, stack: 'hidden' }
	];
	/** The snapshot's fallbacks (`repositories/draws.ts`): a bond nobody bought or nobody holds. */
	const NO_BUYER = 'Sin comprador';
	const NO_COLLECTOR = 'Sin cobrador';
	/** On a phone the buyer and the collector share one line: «Ana Gómez, lo cobra Jorge Medina». */
	const who = (row: Entry) => {
		const collector = row.collectorName !== NO_COLLECTOR ? row.collectorName : null;
		if (row.buyerName === NO_BUYER) return collector ? `Lo tiene ${collector}` : NO_BUYER;
		return collector ? `${row.buyerName}, lo cobra ${collector}` : row.buyerName;
	};
	const rows = $derived(data.entries as Entry[]);
	const eligibilityOptions = [
		{ value: '', label: 'Todos' },
		{ value: 'eligible', label: 'Habilitados' },
		{ value: 'ineligible', label: 'No habilitados' }
	];
	const frozen = $derived(data.roster.status === 'frozen');
	const title = $derived(frozen ? 'Padrón congelado' : 'Padrón generado (vigente)');
	const filtered = $derived(!!data.filters.q || !!data.filters.eligibility);
	const total = $derived(
		`${formatNumber(data.pagination.total)} ${
			data.pagination.total === 1 ? 'número' : 'números'
		}${filtered ? (data.pagination.total === 1 ? ' coincide con la búsqueda' : ' coinciden con la búsqueda') : ''}.`
	);
	const drawHref = $derived(
		resolve('/campaigns/[id]/draws/[drawId]', { id: data.campaign.id, drawId: data.draw.id })
	);
	const listHref = $derived(
		resolve('/campaigns/[id]/draws/[drawId]/roster', {
			id: data.campaign.id,
			drawId: data.draw.id
		})
	);
	const winnersHref = $derived(
		resolve('/campaigns/[id]/draws/[drawId]/winners', {
			id: data.campaign.id,
			drawId: data.draw.id
		})
	);
	/** This roster with other filters or at another page (only a search string is appended). */
	function link(values: { q?: string; eligibility?: string; page?: number }): ResolvedPathname {
		const pairs: [string, string][] = [];
		if (values.q) pairs.push(['q', values.q]);
		if (values.eligibility) pairs.push(['eligibility', values.eligibility]);
		if (values.page && values.page > 1) pairs.push(['page', String(values.page)]);
		const search = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
		return (search ? `${listHref}?${search}` : listHref) as ResolvedPathname;
	}
	const pageLink = (page: number) =>
		link({ q: data.filters.q, eligibility: data.filters.eligibility, page });
	const applied = $derived<AppliedFilter[]>(
		data.filters.eligibility
			? [
					{
						label: `Elegibilidad: ${
							eligibilityOptions.find((option) => option.value === data.filters.eligibility)
								?.label ?? data.filters.eligibility
						}`,
						removeHref: link({ q: data.filters.q })
					}
				]
			: []
	);
</script>

<svelte:head><title>Padrón - {data.draw.name}</title></svelte:head>

<PageHeader
	{title}
	description="{data.draw.name}. {total}"
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: data.campaign.name, href: resolve('/campaigns/[id]', { id: data.campaign.id }) },
		{ label: 'Sorteos', href: resolve('/campaigns/[id]/draws', { id: data.campaign.id }) },
		{ label: data.draw.name, href: drawHref },
		{ label: 'Padrón' }
	]}
>
	{#snippet actions()}
		{#if frozen}
			<Button
				href={winnersHref}
				variant={data.draw.status === 'roster_frozen' ? 'primary' : 'secondary'}
				>{data.draw.status === 'roster_frozen' && data.canLoadWinner
					? 'Cargar ganadores'
					: 'Ver ganadores y premios'}</Button
			>
		{/if}
	{/snippet}
</PageHeader>

<div class="flex flex-col gap-6">
	{#if !frozen}
		<p class="m-0 max-w-[60ch] text-body text-text" data-roster-note>
			Este padrón todavía puede cambiar: se puede volver a generar hasta que se congele. Se congela
			desde
			<a
				href={drawHref}
				class="rounded-sm font-medium text-primary-text underline underline-offset-2">el sorteo</a
			>.
		</p>
	{/if}

	<FilterBar
		action={listHref}
		searchName="q"
		searchLabel="Número, comprador, cobrador o código"
		searchValue={data.filters.q}
		{applied}
		clearHref={filtered ? listHref : undefined}
	>
		{#snippet filters()}
			<Field label="Elegibilidad" id="filter-eligibility">
				<Select
					name="eligibility"
					options={eligibilityOptions}
					value={data.filters.eligibility ?? ''}
				/>
			</Field>
		{/snippet}
	</FilterBar>

	{#if rows.length === 0}
		{#if filtered}
			<EmptyState title="Ningún número del padrón coincide con la búsqueda" icon="search">
				Probar con otra búsqueda o quitar los filtros para ver todo el padrón.
			</EmptyState>
		{:else}
			<EmptyState title="El padrón no tiene números">
				Ningún número participa de este sorteo.
			</EmptyState>
		{/if}
	{:else}
		<Table {columns} {rows} density="compact" caption="Números del padrón" stack>
			{#snippet cell({ row, column })}
				{#if column.key === 'formattedNumber'}
					<span class="inline-flex flex-wrap items-baseline gap-2">
						<BondNumber number={row.formattedNumber} size="sm" />
						{#if row.numberKind === 'extraordinary'}<Badge tone="info"
								>Extra (sorteo anterior)</Badge
							>{/if}
					</span>
				{:else if column.key === 'eligibility'}
					{#if row.eligible}
						<Badge tone="success">Habilitado</Badge>
					{:else}
						<Badge tone="warning">No habilitado</Badge>
					{/if}
				{:else if column.key === 'buyerName'}
					<span class="max-[719px]:hidden">{row.buyerName}</span>
					<span class="min-[720px]:hidden">{who(row)}</span>
				{:else if column.key === 'reason'}
					{row.eligible ? '' : (row.reasonLabel ?? '')}
				{:else}
					{row[column.key as keyof Entry]}
				{/if}
			{/snippet}
		</Table>
	{/if}

	{#if data.pagination.pages > 1}
		<nav
			aria-label="Páginas del padrón"
			class="flex items-center justify-between gap-3 text-body-sm"
		>
			{#if data.pagination.page > 1}
				<Button href={pageLink(data.pagination.page - 1)} rel="prev">Anterior</Button>
			{:else}
				<span></span>
			{/if}
			<span class="text-muted tabular-nums"
				>Página {formatNumber(data.pagination.page)} de {formatNumber(data.pagination.pages)}</span
			>
			{#if data.pagination.page < data.pagination.pages}
				<Button href={pageLink(data.pagination.page + 1)} rel="next">Siguiente</Button>
			{:else}
				<span></span>
			{/if}
		</nav>
	{/if}
</div>

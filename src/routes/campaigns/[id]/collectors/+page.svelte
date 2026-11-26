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
		Money,
		PageHeader,
		Select,
		StatusBadge,
		Table,
		type AppliedFilter,
		type TableColumn
	} from '$lib/components/ui';
	import { COLLECTOR_STATUSES, COLLECTOR_STATUS_LABELS } from '$lib/domain/parties';
	import {
		bondCountWords,
		collectorBalanceWords,
		listSearch,
		showingWords,
		dialNumber
	} from '$lib/domain/people-draw-lists';
	import { formatNumber } from '$lib/format';
	import type { PageProps } from './$types';

	/**
	 * Collectors list (UX plan PR 14b, audit A7): the search first, the status filter folded, and each
	 * row says who the collector is, how many bonds of this campaign are assigned to them and, for the
	 * roles that read it, their balance. GET filters (they live in the query string, so the page works
	 * without JavaScript and can be bookmarked), server-side pages. Below 720px each row is a block of
	 * two lines instead of a strip of columns.
	 */
	let { data }: PageProps = $props();

	const campaign = $derived(data.campaign);
	const pagination = $derived(data.pagination);
	const listHref = $derived(resolve('/campaigns/[id]/collectors', { id: campaign.id }));
	const filtered = $derived(Boolean(data.query.q || data.query.status));
	/**
	 * This list with some filters, at a page. The pathname is `resolve()`d; only a search string is
	 * appended, which `ResolvedPathname` does not model (hence the cast).
	 */
	const link = (values: Record<string, string>, page = 1) =>
		`${listHref}${listSearch(values, page)}` as ResolvedPathname;
	const pageLink = (page: number) => link(data.query, page);
	const recordHref = (collectorId: string) =>
		resolve('/campaigns/[id]/collectors/[collectorId]', { id: campaign.id, collectorId });

	type Row = (typeof data.collectors)[number] & Record<string, unknown>;
	const rows = $derived(data.collectors as Row[]);
	const columns = $derived<TableColumn<Row>[]>([
		{ key: 'name', header: 'Cobrador', stack: 'primary' },
		{ key: 'bonds', header: 'Bonos asignados', align: 'right', stack: 'trailing' },
		...(data.can.balances
			? [{ key: 'balance', header: 'Saldo', align: 'right', stack: 'secondary' } as const]
			: []),
		{ key: 'contact', header: 'Contacto', stack: 'hidden' },
		{ key: 'status', header: 'Estado', stack: 'hidden' },
		{ key: 'linkedUser', header: 'Usuario vinculado', stack: 'hidden' }
	]);
	const statusOptions = [
		{ value: '', label: 'Cualquiera' },
		...COLLECTOR_STATUSES.map((status) => ({
			value: status,
			label: COLLECTOR_STATUS_LABELS[status]
		}))
	];
	const status = $derived(COLLECTOR_STATUSES.find((value) => value === data.query.status));
	const applied = $derived<AppliedFilter[]>(
		status
			? [
					{
						label: `Estado: ${COLLECTOR_STATUS_LABELS[status]}`,
						removeHref: link({ q: data.query.q })
					}
				]
			: []
	);
</script>

<svelte:head><title>Cobradores - {campaign.name} - {institutionName()}</title></svelte:head>

<PageHeader
	title="Cobradores"
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: campaign.name, href: resolve('/campaigns/[id]', { id: campaign.id }) },
		{ label: 'Cobradores' }
	]}
>
	{#snippet actions()}
		{#if data.can.manage}
			<Button
				variant="primary"
				icon="plus"
				href={resolve('/campaigns/[id]/collectors/new', { id: campaign.id })}
			>
				Nuevo cobrador
			</Button>
		{/if}
	{/snippet}
</PageHeader>

<div class="flex flex-col gap-6">
	<FilterBar
		action={listHref}
		searchName="q"
		searchLabel="Nombre, teléfono o correo"
		searchValue={data.query.q}
		{applied}
		clearHref={filtered ? listHref : undefined}
	>
		{#snippet filters()}
			<Field label="Estado" id="filter-status">
				<Select name="status" value={data.query.status} options={statusOptions} />
			</Field>
		{/snippet}
	</FilterBar>

	<section aria-labelledby="results-title" class="flex flex-col gap-3">
		<h2 id="results-title" class="sr-only">Resultados</h2>
		{#if pagination.total === 0}
			<EmptyState
				title={filtered ? 'Ningún cobrador coincide con la búsqueda' : 'Todavía no hay cobradores'}
				icon={filtered ? 'search' : 'inbox'}
			>
				{#if filtered}
					Probar con otro nombre, teléfono o correo.
				{:else if data.can.manage}
					Cargar el primero con «Nuevo cobrador» para poder entregarle bonos.
				{:else}
					Los carga quien administra el sistema.
				{/if}
				{#snippet actions()}
					{#if filtered}<Button href={listHref}>Ver todos los cobradores</Button>{/if}
				{/snippet}
			</EmptyState>
		{:else if rows.length === 0}
			<EmptyState title="No hay cobradores en esta página" icon="search">
				<a href={pageLink(1)} class="text-primary-text underline-offset-2 hover:underline"
					>Ir a la primera página</a
				>
			</EmptyState>
		{:else}
			<p class="m-0 text-body-sm text-muted" aria-live="polite">
				{showingWords(pagination, { one: 'cobrador', many: 'cobradores' })}
			</p>
			<Table
				{columns}
				{rows}
				caption={data.can.balances ? 'Bonos y saldo en esta campaña' : 'Bonos en esta campaña'}
				stack
			>
				{#snippet cell({ row, column })}
					{#if column.key === 'name'}
						<span data-collector-id={row.id} class="flex flex-wrap items-center gap-x-2">
							<a
								href={recordHref(row.id)}
								class="inline-flex min-h-touch items-center rounded-sm font-medium text-primary-text underline-offset-2 [overflow-wrap:anywhere] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus min-[720px]:min-h-0"
								>{row.displayName}</a
							>
							{#if row.status !== 'active'}
								<span class="min-[720px]:hidden"
									><StatusBadge kind="collector" status={row.status} /></span
								>
							{/if}
						</span>
					{:else if column.key === 'bonds'}
						<span class="max-[719px]:hidden">{formatNumber(row.assignedBonds)}</span>
						<span
							class="inline-flex min-h-touch items-center whitespace-nowrap text-body-sm min-[720px]:hidden"
							>{bondCountWords(row.assignedBonds)}</span
						>
					{:else if column.key === 'balance'}
						{@const balance = collectorBalanceWords(row.balance)}
						{#if balance}
							<span data-collector-balance class="whitespace-nowrap">
								{balance.label}
								{#if balance.amount !== null}
									<Money value={balance.amount} class="font-medium text-text" />
								{/if}
							</span>
						{/if}
					{:else if column.key === 'contact'}
						{@const tel = dialNumber(row.phone)}
						{#if tel}
							<a
								href="tel:{tel}"
								class="rounded-sm whitespace-nowrap text-primary-text underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
								>{row.phone}</a
							>
						{:else if row.phone}
							{row.phone}
						{/if}
						{#if row.email}
							<div class="text-caption text-muted [overflow-wrap:anywhere]">{row.email}</div>
						{/if}
						{#if !row.phone && !row.email}—{/if}
					{:else if column.key === 'status'}
						<StatusBadge kind="collector" status={row.status} />
					{:else if column.key === 'linkedUser'}
						{row.userProfileId ? 'Sí' : 'No'}
					{/if}
				{/snippet}
			</Table>
		{/if}

		<Pagination page={pagination.page} pageCount={pagination.pageCount} hrefFor={pageLink} />
	</section>
</div>

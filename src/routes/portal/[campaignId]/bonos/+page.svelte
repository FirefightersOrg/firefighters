<script lang="ts">
	import { institutionName } from '$lib/institution';
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import {
		BondNumber,
		Button,
		EmptyState,
		Field,
		PageHeader,
		Pagination,
		Select,
		StatusBadge,
		Table,
		type TableColumn
	} from '$lib/components/ui';
	import { BOND_COMMERCIAL_STATUS_LABELS, BOND_FINANCIAL_STATUS_LABELS } from '$lib/domain/bonds';
	import { formatMoney, formatNumber } from '$lib/format';
	import type { PageProps } from './$types';

	/** "Mis bonos": the collector's own bonds. Read only; filters live in the query string. */
	let { data }: PageProps = $props();

	const filters = $derived(data.filters);
	const pagination = $derived(data.pagination);
	const listHref = $derived(
		resolve('/portal/[campaignId]/bonos', { campaignId: data.campaign.id })
	);
	const filtered = $derived(Boolean(filters.status || filters.financial));

	const statusOptions = [
		{ value: '', label: 'Todos' },
		...Object.entries(BOND_COMMERCIAL_STATUS_LABELS).map(([value, label]) => ({ value, label }))
	];
	const financialOptions = [
		{ value: '', label: 'Todos' },
		...Object.entries(BOND_FINANCIAL_STATUS_LABELS).map(([value, label]) => ({ value, label }))
	];

	function pageLink(page: number): ResolvedPathname {
		const pairs: [string, string][] = [];
		if (filters.status) pairs.push(['status', filters.status]);
		if (filters.financial) pairs.push(['financial', filters.financial]);
		if (page > 1) pairs.push(['page', String(page)]);
		const search = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
		return (search ? `${listHref}?${search}` : listHref) as ResolvedPathname;
	}
	const detailHref = (bondId: string) =>
		resolve('/portal/[campaignId]/bonos/[bondId]', { campaignId: data.campaign.id, bondId });

	type Row = (typeof data.bonds)[number] & Record<string, unknown>;
	const columns: TableColumn<Row>[] = [
		{ key: 'base', header: 'Número', stack: 'primary' },
		{ key: 'status', header: 'Estado', stack: 'trailing' },
		{ key: 'financial', header: 'Pagos', stack: 'secondary' },
		{ key: 'associated', header: 'Número asociado', mono: true, stack: 'hidden' },
		{ key: 'type', header: 'Tipo', stack: 'hidden' },
		{ key: 'value', header: 'Valor', align: 'right', stack: 'hidden' }
	];
	const join = (values: string[]) => (values.length ? values.join(', ') : '—');
</script>

<svelte:head>
	<title>Mis bonos - {institutionName()}</title>
</svelte:head>

<PageHeader
	title="Mis bonos"
	description={`Campaña ${data.campaign.name}`}
	breadcrumbs={[{ label: 'Mi portal', href: resolve('/portal') }, { label: 'Mis bonos' }]}
/>

{#if !data.collector}
	<EmptyState title="El usuario todavía no está vinculado a un cobrador">
		Pedir a un administrador que vincule el usuario con la ficha de cobrador.
	</EmptyState>
{:else}
	<div class="flex flex-col gap-6">
		<form method="GET" action={listHref} class="flex flex-wrap items-end gap-4">
			<Field label="Estado comercial" id="filter-status">
				<Select name="status" value={filters.status} options={statusOptions} />
			</Field>
			<Field label="Estado financiero" id="filter-financial">
				<Select name="financial" value={filters.financial} options={financialOptions} />
			</Field>
			<Button type="submit">Filtrar</Button>
			{#if filtered}
				<Button href={listHref}>Quitar filtros</Button>
			{/if}
		</form>

		<p class="m-0 text-body-sm text-muted" aria-live="polite">
			{formatNumber(pagination.total)}
			{pagination.total === 1 ? 'bono' : 'bonos'}
		</p>

		<Table {columns} rows={data.bonds as Row[]} caption="Bonos asignados" stack>
			{#snippet cell({ row, column })}
				{#if column.key === 'base'}
					<!-- The number is the way into the bond: no separate «Ver detalle» column. -->
					<BondNumber number={join(row.baseNumbers)} size="sm" href={detailHref(row.id)} />
				{:else if column.key === 'associated'}
					{join(row.associatedNumbers)}
				{:else if column.key === 'type'}
					{row.typeLabel}
				{:else if column.key === 'status'}
					<StatusBadge kind="bondCommercial" status={row.commercialStatus} />
				{:else if column.key === 'financial'}
					<StatusBadge kind="bondFinancial" status={row.financialStatus} />
				{:else if column.key === 'value'}
					{formatMoney(row.totalValue)}
				{/if}
			{/snippet}
			{#snippet empty()}
				<EmptyState
					title={filtered
						? 'Ningún bono coincide con los filtros'
						: 'Todavía no hay bonos asignados'}
				>
					{filtered
						? 'Probar con otros estados o quitar los filtros.'
						: 'Cuando se entreguen bonos a este cobrador, van a aparecer aquí.'}
				</EmptyState>
			{/snippet}
		</Table>

		<Pagination page={pagination.page} pageCount={pagination.pageCount} hrefFor={pageLink} />
	</div>
{/if}

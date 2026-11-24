<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import {
		Button,
		Card,
		EmptyState,
		Field,
		PageHeader,
		Select,
		StatusBadge,
		Table,
		TextInput
	} from '$lib/components/ui';
	import type { TableColumn } from '$lib/components/ui';
	import { PAYMENT_MODE_LABELS } from '$lib/domain/sales';
	import type { BondFinancialStatus } from '$lib/domain/bonds';
	import { formatMoney } from '$lib/format';
	import { campaignNumberingConfig } from '$lib/domain/campaigns';
	import { formatCampaignNumber } from '$lib/domain/numbering';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	const href = $derived(resolve('/campaigns/[id]/sales', { id: data.campaign.id }));
	const numbering = $derived(campaignNumberingConfig(data.campaign));
	const bondLabel = (pairs: { base: number; associated: number | null }[]) =>
		pairs
			.map(
				({ base, associated }) =>
					`${formatCampaignNumber(base, numbering)}${
						associated === null ? '' : ` / ${formatCampaignNumber(associated, numbering)}`
					}`
			)
			.join(', ');
	function pageLink(page: number): ResolvedPathname {
		const pairs = Object.entries(data.filters).filter(([, value]) => value);
		if (page > 1) pairs.push(['page', String(page)]);
		const search = pairs.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
		return (search ? `${href}?${search}` : href) as ResolvedPathname;
	}
	const rows = $derived(
		data.sales.map((item) => ({
			id: item.sale.id,
			bond: bondLabel(item.bondNumberPairs),
			buyerName: item.buyerName,
			collectorName: item.collectorName,
			mode: PAYMENT_MODE_LABELS[item.sale.paymentMode],
			total: formatMoney(item.sale.totalAmount, { decimals: 'always' }),
			financialStatus: item.financialStatus as BondFinancialStatus
		}))
	);
	type Row = (typeof rows)[number];
	const columns: TableColumn<Row>[] = [
		{ key: 'bond', header: 'Bono', mono: true },
		{ key: 'buyerName', header: 'Comprador' },
		{ key: 'collectorName', header: 'Cobrador' },
		{ key: 'mode', header: 'Modalidad' },
		{ key: 'total', header: 'Total', align: 'right' },
		{ key: 'financialStatus', header: 'Estado financiero' }
	];
	const collectorOptions = $derived([
		{ value: '', label: 'Todos' },
		...data.collectors.map((c) => ({ value: c.id, label: c.displayName }))
	]);
	const modeOptions = [
		{ value: '', label: 'Todas' },
		...Object.entries(PAYMENT_MODE_LABELS).map(([value, label]) => ({ value, label }))
	];
	const financialOptions = [
		{ value: '', label: 'Todos' },
		{ value: 'no_payments', label: 'Sin pagos' },
		{ value: 'overdue', label: 'En mora' },
		{ value: 'partial_payments', label: 'Pagos parciales' },
		{ value: 'up_to_date', label: 'Al día' }
	];
	const filtered = $derived(Object.values(data.filters).some(Boolean));
</script>

<svelte:head><title>Ventas - {data.campaign.name}</title></svelte:head>

<PageHeader
	title="Ventas"
	description="Ventas registradas de la campaña."
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: data.campaign.name, href: resolve('/campaigns/[id]', { id: data.campaign.id }) },
		{ label: 'Ventas' }
	]}
>
	{#snippet actions()}
		{#if data.can.create}
			<Button
				variant="primary"
				icon="plus"
				href={resolve('/campaigns/[id]/sales/new', { id: data.campaign.id })}
				>Registrar venta</Button
			>
		{/if}
	{/snippet}
</PageHeader>

<div class="space-y-6">
	<Card>
		<form method="GET" class="grid gap-4 sm:grid-cols-5 sm:items-end">
			<Field label="Cobrador">
				<Select name="collector" options={collectorOptions} value={data.filters.collector ?? ''} />
			</Field>
			<Field label="Comprador">
				<TextInput name="buyer" value={data.filters.buyer ?? ''} />
			</Field>
			<Field label="Modalidad">
				<Select name="paymentMode" options={modeOptions} value={data.filters.paymentMode ?? ''} />
			</Field>
			<Field label="Estado financiero">
				<Select
					name="financialStatus"
					options={financialOptions}
					value={data.filters.financialStatus ?? ''}
				/>
			</Field>
			<div class="flex gap-2">
				<Button type="submit" variant="primary">Filtrar</Button>
				{#if filtered}<Button variant="ghost" {href}>Limpiar</Button>{/if}
			</div>
		</form>
	</Card>

	<Table {columns} {rows} caption="Ventas de la campaña">
		{#snippet cell({ row, column })}
			{#if column.key === 'bond'}
				<a
					class="rounded-sm text-primary-text underline-offset-2 hover:underline"
					href={resolve('/campaigns/[id]/sales/[saleId]', { id: data.campaign.id, saleId: row.id })}
					>{row.bond}</a
				>
			{:else if column.key === 'total'}
				<span class="tabular-nums">{row.total}</span>
			{:else if column.key === 'financialStatus'}
				<StatusBadge kind="bondFinancial" status={row.financialStatus} />
			{:else}
				{row[column.key as keyof Row]}
			{/if}
		{/snippet}
		{#snippet empty()}
			<EmptyState
				title={filtered ? 'Ninguna venta coincide con el filtro' : 'Todavía no hay ventas'}
			/>
		{/snippet}
	</Table>

	{#if data.pagination.pageCount > 1}
		<nav aria-label="Páginas de ventas" class="flex items-center justify-between text-body">
			<span>Página {data.pagination.page} de {data.pagination.pageCount}</span>
			<span class="flex gap-2">
				{#if data.pagination.page > 1}
					<Button href={pageLink(data.pagination.page - 1)}>Anterior</Button>
				{/if}
				{#if data.pagination.page < data.pagination.pageCount}
					<Button href={pageLink(data.pagination.page + 1)}>Siguiente</Button>
				{/if}
			</span>
		</nav>
	{/if}
</div>

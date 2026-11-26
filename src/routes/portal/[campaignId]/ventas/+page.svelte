<script lang="ts">
	import { institutionName } from '$lib/institution';
	import { resolve } from '$app/paths';
	import { BondNumber, EmptyState, PageHeader, StatusBadge, Table } from '$lib/components/ui';
	import type { TableColumn } from '$lib/components/ui';
	import PortalPagination from '$lib/components/portal/PortalPagination.svelte';
	import { bondLabel } from '$lib/portal/labels';
	import { formatDate, formatMoney } from '$lib/format';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const rows = $derived(data.sales.map((sale) => ({ ...sale, id: sale.saleId })));
	type Row = (typeof rows)[number];
	const columns: TableColumn<Row>[] = [
		{ key: 'bond', header: 'Bono', stack: 'primary' },
		{ key: 'balance', header: 'Saldo', align: 'right', stack: 'trailing' },
		{ key: 'buyerName', header: 'Comprador', stack: 'secondary' },
		{ key: 'financialStatus', header: 'Pagos', stack: 'secondary' },
		{ key: 'nextDueDate', header: 'Próximo vencimiento' },
		{ key: 'saleStatus', header: 'Venta', stack: 'hidden' }
	];
</script>

<svelte:head><title>Mis ventas - {institutionName()}</title></svelte:head>

<PageHeader
	title="Mis ventas"
	description="Ventas propias con el estado de sus cuotas y el saldo pendiente."
	breadcrumbs={[{ label: 'Mi portal', href: resolve('/portal') }, { label: 'Mis ventas' }]}
/>

<div class="space-y-6">
	<Table {columns} {rows} caption="Mis ventas" stack>
		{#snippet cell({ row, column })}
			{#if column.key === 'bond'}
				<BondNumber
					number={bondLabel(row.bondNumbers, row.numberDigits)}
					size="sm"
					href={resolve('/portal/[campaignId]/ventas/[saleId]', {
						campaignId: data.campaign.id,
						saleId: row.saleId
					})}
				/>
			{:else if column.key === 'buyerName'}
				<a
					class="rounded-sm text-primary-text underline-offset-2 hover:underline"
					href={resolve('/portal/[campaignId]/compradores/[buyerId]', {
						campaignId: data.campaign.id,
						buyerId: row.buyerId
					})}>{row.buyerName}</a
				>
			{:else if column.key === 'saleStatus'}
				<StatusBadge kind="sale" status={row.saleStatus} />
			{:else if column.key === 'financialStatus'}
				{#if row.financialStatus}
					<StatusBadge kind="bondFinancial" status={row.financialStatus} />
				{:else}—{/if}
			{:else if column.key === 'balance'}
				<span class="tabular-nums">{formatMoney(row.balance, { decimals: 'always' })}</span>
			{:else if column.key === 'nextDueDate'}
				{row.nextDueDate ? formatDate(row.nextDueDate) : '—'}
				{#if row.overdueCount > 0}<span class="text-danger-text"
						>({row.overdueCount} vencida{row.overdueCount === 1 ? '' : 's'})</span
					>{/if}
			{:else}
				{row[column.key as keyof Row]}
			{/if}
		{/snippet}
		{#snippet empty()}
			<EmptyState title={data.collector ? 'Todavía no hay ventas' : 'Sin cobrador vinculado'}>
				{data.collector
					? 'Las ventas de los bonos entregados aparecen aquí cuando se registran.'
					: 'El usuario no está vinculado a un cobrador. Pedir a un administrador que lo vincule.'}
			</EmptyState>
		{/snippet}
	</Table>

	<PortalPagination
		page={data.pagination.page}
		pageCount={data.pagination.pageCount}
		path={resolve('/portal/[campaignId]/ventas', { campaignId: data.campaign.id })}
		label="Páginas de ventas"
	/>
</div>

<script lang="ts">
	import { resolve } from '$app/paths';
	import { EmptyState, PageHeader, StatusBadge, Table } from '$lib/components/ui';
	import type { TableColumn } from '$lib/components/ui';
	import PortalPagination from '$lib/components/portal/PortalPagination.svelte';
	import { bondLabel } from '$lib/portal/labels';
	import { formatDate, formatMoney } from '$lib/format';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const rows = $derived(data.due.map((item) => ({ ...item, id: item.installmentId })));
	type Row = (typeof rows)[number];
	const columns: TableColumn<Row>[] = [
		{ key: 'dueDate', header: 'Vencimiento' },
		{ key: 'buyerName', header: 'Comprador' },
		{ key: 'buyerPhone', header: 'Teléfono' },
		{ key: 'bond', header: 'Bono', mono: true },
		{ key: 'installmentNumber', header: 'Cuota', align: 'right' },
		{ key: 'balance', header: 'Saldo', align: 'right' },
		{ key: 'status', header: 'Estado' }
	];
</script>

<svelte:head><title>Por cobrar - Firefighters</title></svelte:head>

<PageHeader
	title="Por cobrar"
	description="Cuotas vencidas y las que vencen en los próximos 7 días."
	breadcrumbs={[{ label: 'Mi portal', href: resolve('/portal') }, { label: 'Por cobrar' }]}
/>

<div class="space-y-6">
	<Table {columns} {rows} caption="Cuotas por cobrar">
		{#snippet cell({ row, column })}
			{#if column.key === 'dueDate'}
				{formatDate(row.dueDate)}
			{:else if column.key === 'buyerName'}
				<a
					class="rounded-sm text-primary-text underline-offset-2 hover:underline"
					href={resolve('/portal/[campaignId]/compradores/[buyerId]', {
						campaignId: data.campaign.id,
						buyerId: row.buyerId
					})}>{row.buyerName}</a
				>
			{:else if column.key === 'buyerPhone'}
				{row.buyerPhone ?? '—'}
			{:else if column.key === 'bond'}
				<a
					class="rounded-sm text-primary-text underline-offset-2 hover:underline"
					href={resolve('/portal/[campaignId]/ventas/[saleId]', {
						campaignId: data.campaign.id,
						saleId: row.saleId
					})}>{bondLabel(row.bondNumbers, row.numberDigits)}</a
				>
			{:else if column.key === 'balance'}
				<span class="tabular-nums">{formatMoney(row.balance, { decimals: 'always' })}</span>
			{:else if column.key === 'status'}
				<StatusBadge kind="installment" status={row.status} />
			{:else}
				{row[column.key as keyof Row]}
			{/if}
		{/snippet}
		{#snippet empty()}
			<EmptyState title={data.collector ? 'No hay cuotas por cobrar' : 'Sin cobrador vinculado'}>
				{data.collector
					? 'No hay cuotas vencidas ni próximas a vencer.'
					: 'El usuario no está vinculado a un cobrador. Pedir a un administrador que lo vincule.'}
			</EmptyState>
		{/snippet}
	</Table>

	<PortalPagination
		page={data.pagination.page}
		pageCount={data.pagination.pageCount}
		path={resolve('/portal/[campaignId]/por-cobrar', { campaignId: data.campaign.id })}
		label="Páginas de cuotas por cobrar"
	/>
</div>

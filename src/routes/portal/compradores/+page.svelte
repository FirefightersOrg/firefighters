<script lang="ts">
	import { resolve } from '$app/paths';
	import { EmptyState, PageHeader, Table } from '$lib/components/ui';
	import type { TableColumn } from '$lib/components/ui';
	import PortalPagination from '$lib/components/portal/PortalPagination.svelte';
	import { formatMoney } from '$lib/format';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const rows = $derived(data.buyers.map((buyer) => ({ ...buyer })));
	type Row = (typeof rows)[number];
	const columns: TableColumn<Row>[] = [
		{ key: 'displayName', header: 'Comprador' },
		{ key: 'phone', header: 'Teléfono' },
		{ key: 'address', header: 'Dirección' },
		{ key: 'saleCount', header: 'Ventas', align: 'right' },
		{ key: 'balance', header: 'Saldo', align: 'right' }
	];
</script>

<svelte:head><title>Mis compradores - Firefighters</title></svelte:head>

<PageHeader
	title="Mis compradores"
	description="Compradores de las ventas propias, con los datos necesarios para cobrar."
	breadcrumbs={[{ label: 'Mi portal', href: resolve('/portal') }, { label: 'Mis compradores' }]}
/>

<div class="space-y-6">
	<Table {columns} {rows} caption="Mis compradores">
		{#snippet cell({ row, column })}
			{#if column.key === 'displayName'}
				<a
					class="rounded-sm text-primary-text underline-offset-2 hover:underline"
					href={resolve('/portal/compradores/[buyerId]', { buyerId: row.id })}>{row.displayName}</a
				>
			{:else if column.key === 'balance'}
				<span class="tabular-nums">{formatMoney(row.balance, { decimals: 'always' })}</span>
			{:else if column.key === 'saleCount'}
				<span class="tabular-nums">{row.saleCount}</span>
			{:else}
				{row[column.key as keyof Row] ?? '—'}
			{/if}
		{/snippet}
		{#snippet empty()}
			<EmptyState title={data.collector ? 'Todavía no hay compradores' : 'Sin cobrador vinculado'}>
				{data.collector
					? 'Los compradores aparecen acá cuando se registra una venta propia.'
					: 'El usuario no está vinculado a un cobrador. Pedir a un administrador que lo vincule.'}
			</EmptyState>
		{/snippet}
	</Table>

	<PortalPagination
		page={data.pagination.page}
		pageCount={data.pagination.pageCount}
		path={resolve('/portal/compradores')}
		label="Páginas de compradores"
	/>
</div>

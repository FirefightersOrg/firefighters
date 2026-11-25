<script lang="ts">
	import { resolve } from '$app/paths';
	import { Card, EmptyState, PageHeader, StatusBadge, Table } from '$lib/components/ui';
	import type { TableColumn } from '$lib/components/ui';
	import { bondLabel } from '$lib/portal/labels';
	import { formatDate, formatMoney } from '$lib/format';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const rows = $derived(data.sales.map((sale) => ({ ...sale, id: sale.saleId })));
	type Row = (typeof rows)[number];
	const columns: TableColumn<Row>[] = [
		{ key: 'bond', header: 'Bono', mono: true },
		{ key: 'campaignName', header: 'Campaña' },
		{ key: 'soldAt', header: 'Fecha' },
		{ key: 'saleStatus', header: 'Venta' },
		{ key: 'balance', header: 'Saldo', align: 'right' }
	];
</script>

<svelte:head><title>{data.buyer.displayName} - Firefighters</title></svelte:head>

<PageHeader
	title={data.buyer.displayName}
	breadcrumbs={[
		{ label: 'Mi portal', href: resolve('/portal') },
		{ label: 'Mis compradores', href: resolve('/portal/compradores') },
		{ label: data.buyer.displayName }
	]}
/>

<div class="space-y-6">
	<Card title="Datos de contacto">
		<dl class="m-0 grid gap-2 sm:grid-cols-2">
			<div>
				<dt class="text-label text-muted">Teléfono</dt>
				<dd class="m-0">{data.buyer.phone ?? '—'}</dd>
			</div>
			<div>
				<dt class="text-label text-muted">Dirección</dt>
				<dd class="m-0">{data.buyer.address ?? '—'}</dd>
			</div>
		</dl>
	</Card>

	<Card title="Ventas" flush>
		<Table {columns} {rows} caption="Ventas del comprador">
			{#snippet cell({ row, column })}
				{#if column.key === 'bond'}
					<a
						class="rounded-sm text-primary-text underline-offset-2 hover:underline"
						href={resolve('/portal/ventas/[saleId]', { saleId: row.saleId })}
						>{bondLabel(row.bondNumbers, row.numberDigits)}</a
					>
				{:else if column.key === 'soldAt'}
					{formatDate(row.soldAt)}
				{:else if column.key === 'saleStatus'}
					<StatusBadge kind="sale" status={row.saleStatus} />
				{:else if column.key === 'balance'}
					<span class="tabular-nums">{formatMoney(row.balance, { decimals: 'always' })}</span>
				{:else}
					{row[column.key as keyof Row]}
				{/if}
			{/snippet}
			{#snippet empty()}
				<EmptyState title="Este comprador no tiene ventas propias" />
			{/snippet}
		</Table>
	</Card>
</div>

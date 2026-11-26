<script lang="ts">
	import { institutionName } from '$lib/institution';
	import { resolve } from '$app/paths';
	import { BondNumber, Card, EmptyState, PageHeader, StatusBadge, Table } from '$lib/components/ui';
	import type { TableColumn } from '$lib/components/ui';
	import { bondLabel } from '$lib/portal/labels';
	import { formatDate, formatMoney } from '$lib/format';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const rows = $derived(data.sales.map((sale) => ({ ...sale, id: sale.saleId })));
	type Row = (typeof rows)[number];
	const columns: TableColumn<Row>[] = [
		{ key: 'bond', header: 'Bono', stack: 'primary' },
		{ key: 'balance', header: 'Saldo', align: 'right', stack: 'trailing' },
		{ key: 'soldAt', header: 'Fecha', stack: 'secondary' },
		{ key: 'saleStatus', header: 'Venta', stack: 'secondary' },
		{ key: 'campaignName', header: 'Campaña', stack: 'hidden' }
	];
</script>

<svelte:head><title>{data.buyer.displayName} - {institutionName()}</title></svelte:head>

<PageHeader
	title={data.buyer.displayName}
	breadcrumbs={[
		{ label: 'Mi portal', href: resolve('/portal') },
		{
			label: 'Mis compradores',
			href: resolve('/portal/[campaignId]/compradores', { campaignId: data.campaign.id })
		},
		{ label: data.buyer.displayName }
	]}
/>

<div class="space-y-6">
	<Card title="Datos de contacto">
		<dl class="m-0 grid gap-2 sm:grid-cols-2">
			<div>
				<dt class="text-label text-muted">Teléfono</dt>
				<dd class="m-0">
					{#if data.buyer.phone?.trim()}
						<a
							class="inline-flex min-h-touch items-center rounded-sm text-primary-text underline underline-offset-2"
							href="tel:{data.buyer.phone.replace(/[^\d+]/g, '')}">{data.buyer.phone}</a
						>
					{:else}—{/if}
				</dd>
			</div>
			<div>
				<dt class="text-label text-muted">Dirección</dt>
				<dd class="m-0">{data.buyer.address ?? '—'}</dd>
			</div>
		</dl>
	</Card>

	<Card title="Ventas" flush>
		<Table {columns} {rows} caption="Ventas del comprador" stack>
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

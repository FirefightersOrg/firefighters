<script lang="ts">
	import { resolve } from '$app/paths';
	import { Card, EmptyState, PageHeader, Stat, StatusBadge, Table } from '$lib/components/ui';
	import type { TableColumn } from '$lib/components/ui';
	import InstallmentsTable from '$lib/components/portal/InstallmentsTable.svelte';
	import { PAYMENT_MODE_LABELS } from '$lib/domain/sales';
	import { bondLabel } from '$lib/portal/labels';
	import { formatDate, formatMoney } from '$lib/format';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const sale = $derived(data.sale);
	const bond = $derived(bondLabel(sale.bondNumbers, sale.numberDigits));
	const methodLabel = { cash: 'Efectivo', transfer: 'Transferencia' } as const;
	const paymentRows = $derived(data.payments.map((payment) => ({ ...payment })));
	const paymentColumns: TableColumn<(typeof paymentRows)[number]>[] = [
		{ key: 'paymentDate', header: 'Fecha' },
		{ key: 'amount', header: 'Monto', align: 'right' },
		{ key: 'method', header: 'Medio' },
		{ key: 'status', header: 'Estado' }
	];
</script>

<svelte:head><title>Venta {bond} - Firefighters</title></svelte:head>

<PageHeader
	title={`Venta del bono ${bond}`}
	description={`${sale.campaignName} · ${PAYMENT_MODE_LABELS[sale.paymentMode]} · ${formatDate(sale.soldAt)}`}
	breadcrumbs={[
		{ label: 'Mi portal', href: resolve('/portal') },
		{ label: 'Mis ventas', href: resolve('/portal/ventas') },
		{ label: `Bono ${bond}` }
	]}
/>

<div class="space-y-6">
	<div class="grid gap-4 sm:grid-cols-4">
		<Stat label="Total" value={formatMoney(sale.totalAmount, { decimals: 'always' })} />
		<Stat label="Cobrado" value={formatMoney(sale.paidAmount, { decimals: 'always' })} />
		<Stat
			label="Pendiente de rendición"
			value={formatMoney(sale.pendingAmount, { decimals: 'always' })}
		/>
		<Stat label="Saldo" value={formatMoney(sale.balance, { decimals: 'always' })} />
	</div>

	<Card title="Comprador">
		<dl class="m-0 grid gap-2 sm:grid-cols-2">
			<div>
				<dt class="text-label text-muted">Nombre</dt>
				<dd class="m-0">
					<a
						class="rounded-sm text-primary-text underline-offset-2 hover:underline"
						href={resolve('/portal/compradores/[buyerId]', { buyerId: sale.buyerId })}
						>{sale.buyerName}</a
					>
				</dd>
			</div>
			<div>
				<dt class="text-label text-muted">Teléfono</dt>
				<dd class="m-0">{sale.buyerPhone ?? '—'}</dd>
			</div>
			<div>
				<dt class="text-label text-muted">Dirección</dt>
				<dd class="m-0">{sale.buyerAddress ?? '—'}</dd>
			</div>
			<div>
				<dt class="text-label text-muted">Estado</dt>
				<dd class="m-0 flex gap-2">
					<StatusBadge kind="sale" status={sale.saleStatus} />
					{#if sale.financialStatus}
						<StatusBadge kind="bondFinancial" status={sale.financialStatus} />
					{/if}
				</dd>
			</div>
		</dl>
	</Card>

	<Card title="Cuotas" flush>
		<InstallmentsTable installments={data.installments} />
	</Card>

	<Card title="Pagos aplicados" flush>
		<Table columns={paymentColumns} rows={paymentRows} rowKey="id" caption="Pagos de la venta">
			{#snippet cell({ row, column })}
				{#if column.key === 'paymentDate'}
					{formatDate(row.paymentDate)}
				{:else if column.key === 'amount'}
					<span class="tabular-nums">{formatMoney(row.amount, { decimals: 'always' })}</span>
				{:else if column.key === 'method'}
					{methodLabel[row.method]}
				{:else if column.key === 'status'}
					<StatusBadge kind="payment" status={row.status} />
				{/if}
			{/snippet}
			{#snippet empty()}
				<EmptyState title="Todavía no hay pagos" />
			{/snippet}
		</Table>
	</Card>
</div>

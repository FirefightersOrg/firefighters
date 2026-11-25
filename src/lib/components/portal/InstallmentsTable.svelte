<script lang="ts">
	import type { Snippet } from 'svelte';
	import { EmptyState, StatusBadge, Table } from '$lib/components/ui';
	import type { TableColumn } from '$lib/components/ui';
	import { formatDate, formatMoney } from '$lib/format';
	import type { PortalInstallment } from '$lib/server/repositories/portal';

	/**
	 * Installment plan of an own sale. Read-only today; SAN-147 ("Registrar cobro") passes `actions` to add a
	 * per-installment control in a last column, without touching the rest of the table.
	 */
	let {
		installments,
		actions
	}: { installments: PortalInstallment[]; actions?: Snippet<[PortalInstallment]> } = $props();

	const rows = $derived(installments.map((i) => ({ ...i })));
	type Row = (typeof rows)[number];
	const columns = $derived<TableColumn<Row>[]>([
		{ key: 'number', header: 'Cuota', align: 'right' },
		{ key: 'dueDate', header: 'Vencimiento' },
		{ key: 'amount', header: 'Monto', align: 'right' },
		{ key: 'pendingAmount', header: 'Pendiente de rendición', align: 'right' },
		{ key: 'balance', header: 'Saldo', align: 'right' },
		{ key: 'status', header: 'Estado' },
		...(actions ? [{ key: 'actions', header: 'Acciones' }] : [])
	]);
	const hasPending = (row: Row) => Number(row.pendingAmount) > 0;
</script>

<Table {columns} {rows} rowKey="id" caption="Cuotas de la venta">
	{#snippet cell({ row, column })}
		{#if column.key === 'dueDate'}
			{formatDate(row.dueDate)}
		{:else if column.key === 'amount'}
			<span class="tabular-nums">{formatMoney(row.amount, { decimals: 'always' })}</span>
		{:else if column.key === 'pendingAmount'}
			<span class="tabular-nums"
				>{hasPending(row) ? formatMoney(row.pendingAmount, { decimals: 'always' }) : '—'}</span
			>
		{:else if column.key === 'balance'}
			<span class="tabular-nums">{formatMoney(row.balance, { decimals: 'always' })}</span>
		{:else if column.key === 'status'}
			<StatusBadge kind="installment" status={row.status} />
		{:else if column.key === 'actions'}
			{@render actions?.(row)}
		{:else}
			{row[column.key as keyof Row]}
		{/if}
	{/snippet}
	{#snippet empty()}
		<EmptyState title="Esta venta no tiene cuotas" />
	{/snippet}
</Table>

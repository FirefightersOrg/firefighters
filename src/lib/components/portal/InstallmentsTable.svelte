<script lang="ts">
	import type { Snippet } from 'svelte';
	import { EmptyState, StatusBadge, Table } from '$lib/components/ui';
	import type { TableColumn } from '$lib/components/ui';
	import { formatDate, formatMoney } from '$lib/format';
	import type { PortalInstallment } from '$lib/server/repositories/portal';

	/**
	 * Installment plan of an own sale. `actions` adds a per-installment control («Cobrar») in a last
	 * column. Below 720px each installment is a stacked block instead of a strip of columns.
	 */
	let {
		installments,
		actions
	}: { installments: PortalInstallment[]; actions?: Snippet<[PortalInstallment]> } = $props();

	const rows = $derived(installments.map((i) => ({ ...i })));
	type Row = (typeof rows)[number];
	const columns = $derived<TableColumn<Row>[]>([
		{ key: 'number', header: 'Cuota', align: 'right', stack: 'primary' },
		{ key: 'balance', header: 'Saldo', align: 'right', stack: 'trailing' },
		{ key: 'dueDate', header: 'Vencimiento', stack: 'secondary' },
		{ key: 'status', header: 'Estado' },
		{ key: 'amount', header: 'Monto', align: 'right' },
		{ key: 'pendingAmount', header: 'Pendiente de rendición', align: 'right' },
		...(actions ? [{ key: 'actions', header: 'Acciones' } satisfies TableColumn<Row>] : [])
	]);
	const hasPending = (row: Row) => Number(row.pendingAmount) > 0;
</script>

<Table {columns} {rows} rowKey="id" caption="Cuotas de la venta" stack>
	{#snippet cell({ row, column })}
		{#if column.key === 'number'}
			<span class="min-[720px]:hidden">Cuota </span>{row.number}
		{:else if column.key === 'dueDate'}
			<span class="min-[720px]:hidden">Vence el </span>{formatDate(row.dueDate)}
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

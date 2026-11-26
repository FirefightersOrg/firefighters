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
		// On a phone the state and what is in a settlement are part of the second line.
		{ key: 'status', header: 'Estado', stack: 'hidden' },
		{ key: 'amount', header: 'Monto', align: 'right', stack: 'hidden' },
		{ key: 'pendingAmount', header: 'Pendiente de rendición', align: 'right', stack: 'hidden' },
		...(actions
			? [{ key: 'actions', header: 'Acciones', stack: 'secondary' } satisfies TableColumn<Row>]
			: [])
	]);
	const hasPending = (row: Row) => Number(row.pendingAmount) > 0;
	/** The word before the date on a phone, where there is no column header. */
	const dueWord = (row: Row) =>
		row.status === 'overdue' ? 'Venció el\u00a0' : row.status === 'pending' ? 'Vence el\u00a0' : '';
</script>

<Table {columns} {rows} rowKey="id" caption="Cuotas de la venta" stack>
	{#snippet cell({ row, column })}
		{#if column.key === 'number'}
			<span class="min-[720px]:hidden">Cuota&nbsp;</span>{row.number}
		{:else if column.key === 'dueDate'}
			<span class="min-[720px]:hidden">{dueWord(row)}</span>{formatDate(row.dueDate)}
			<span class="ml-1 inline-flex flex-wrap items-center gap-x-2 align-middle min-[720px]:hidden">
				<StatusBadge kind="installment" status={row.status} />
				{#if hasPending(row)}
					<span>{formatMoney(row.pendingAmount, { decimals: 'always' })} en rendición</span>
				{/if}
			</span>
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

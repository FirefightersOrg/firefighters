<script lang="ts" module>
	/** What the payments did to one installment (see `listInstallmentPaymentsForSale`). */
	export interface InstallmentPaymentsView {
		installmentNumber: number;
		/** The latest confirmed payment. */
		lastPayment: { date: string; method: string; settlementNumber: number | null } | null;
		/** What payments that are not confirmed yet apply, as a decimal string. */
		waiting: string;
		waitingPayment: {
			date: string;
			method: string;
			settlementNumber: number | null;
			submittedByCollector: boolean;
		} | null;
	}
</script>

<script lang="ts">
	import { Badge, Money } from '$lib/components/ui';
	import type { BondSummaryRow } from '$lib/domain/bond-summary';
	import { centsToDecimalString } from '$lib/domain/money';
	import { formatDate, formatMoney } from '$lib/format';

	/**
	 * The installments of a sale, one line each: what is still owed on it and when it is due, or how
	 * it was paid; a payment that is not confirmed yet is named under its installment, and the list
	 * ends with what is left to collect. The bond record and the sale record render the same list
	 * from the same rows, so they cannot disagree.
	 */
	let {
		rows,
		payments,
		debtCents,
		totalAmount,
		canViewPayments = true,
		closing = true,
		label
	}: {
		/** From `installmentRows()`: the installments that count, with what each still owes. */
		rows: readonly BondSummaryRow[];
		payments: readonly InstallmentPaymentsView[];
		debtCents: number;
		/** The sale's total, as a decimal string: the closing figure once nothing is owed. */
		totalAmount: string;
		/** `false` when the role cannot read payments: the list says so instead of guessing. */
		canViewPayments?: boolean;
		/** The closing line with what is left to collect; `false` where the page already leads with it. */
		closing?: boolean;
		/** Names the list for assistive tech («Cuotas del bono»). */
		label: string;
	} = $props();

	const pesos = (cents: number) => centsToDecimalString(cents);
	const of = (number: number) => payments.find((item) => item.installmentNumber === number);
	const how = (method: string) => (method === 'transfer' ? 'por transferencia' : 'en efectivo');
	/** How an installment with nothing left to pay was paid. */
	const paidLine = (number: number) => {
		const last = of(number)?.lastPayment;
		if (!last) return 'Pagada';
		return `Pagada el ${formatDate(last.date)} ${how(last.method)}${
			last.settlementNumber ? `, rendición ${last.settlementNumber}` : ''
		}`;
	};
	/**
	 * A payment that is not confirmed yet: the installment still owes it until the settlement closes,
	 * and the record says where that money is.
	 */
	const waitingLine = (number: number) => {
		const item = of(number);
		const waiting = item?.waitingPayment;
		if (!item || !waiting) return '';
		const amount = formatMoney(item.waiting);
		return waiting.submittedByCollector
			? `Cobro de ${amount} enviado por el cobrador el ${formatDate(waiting.date)}, sin procesar`
			: `Pago de ${amount} ${how(waiting.method)} cargado en la rendición ${waiting.settlementNumber ?? ''}, que sigue abierta`.replace(
					'  ',
					' '
				);
	};
</script>

<ol class="m-0 list-none p-0" aria-label={label}>
	{#each rows as row (row.number)}
		<li
			class="flex min-h-14 items-center gap-3 border-b border-border py-2"
			data-installment={row.number}
		>
			<span
				class="w-7 shrink-0 font-figure text-[20px] leading-6 font-bold tabular-nums {row.overdue
					? 'text-danger-text'
					: 'text-muted'}"><span class="sr-only">Cuota </span>{row.number}</span
			>
			<span class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-body">
				{#if row.owedCents === 0}
					<span class="text-muted">{paidLine(row.number)}</span>
				{:else}
					<span>{row.overdue ? 'Venció' : 'Vence'} el {formatDate(row.dueDate)}</span>
					{#if row.overdue}<Badge tone="danger">Vencida</Badge>{/if}
					{#if row.owedCents < (Number(row.amount) || 0) * 100}
						<span class="text-body-sm text-muted">pago parcial</span>
					{/if}
					{#if waitingLine(row.number)}
						<span class="basis-full text-body-sm text-muted" data-waiting-payment
							>{waitingLine(row.number)}</span
						>
					{/if}
				{/if}
			</span>
			<Money
				value={pesos(row.owedCents === 0 ? Math.round(Number(row.amount) * 100) : row.owedCents)}
				class="shrink-0 text-body {row.owedCents === 0 ? 'text-muted' : 'font-medium'}"
			/>
		</li>
	{/each}
</ol>
{#if canViewPayments === false}
	<p class="m-0 pt-2 text-body-sm text-muted">
		Sin permiso para ver los pagos: una cuota con un pago parcial figura por su importe completo.
	</p>
{/if}
{#if closing}
	<p class="m-0 flex items-baseline justify-between gap-3 pt-3">
		<span class="text-body font-semibold">{debtCents > 0 ? 'Falta cobrar' : 'Pagado'}</span>
		<Money
			value={debtCents > 0 ? pesos(debtCents) : totalAmount}
			class="font-figure text-figure tabular-nums"
		/>
	</p>
{/if}

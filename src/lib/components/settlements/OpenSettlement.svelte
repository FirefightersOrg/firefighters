<script lang="ts" module>
	import type { PaymentCandidate } from '$lib/domain/settlement-entry';

	export interface OpenSettlementPayment {
		id: string;
		amount: string;
		method: string;
		date: string;
		status: string;
		bondId: string | null;
		bond: string;
		buyer: string | null;
		installments: number[];
	}

	export interface OpenSettlementSubmitted {
		id: string;
		date: string;
		amount: string;
		method: string;
		note: string | null;
		bond: string;
		buyer: string;
		installments: number[];
	}

	export interface OpenSettlementTotals {
		totalCash: string;
		totalTransfer: string;
		totalAmount: string;
		commissionAmount: string;
		commissionPaidAmount: string;
		netToFirefighters: string;
		collectorCreditBalance: string;
	}

	export interface OpenSettlementForm {
		form?: string;
		success?: boolean;
		message?: string;
		errors?: Record<string, string[] | undefined>;
		values?: Record<string, unknown>;
	}

	export interface OpenSettlementProps {
		campaignId: string;
		settlement: { settlementNumber: number; collectorName: string };
		totals: OpenSettlementTotals;
		payments: OpenSettlementPayment[];
		candidates: PaymentCandidate[];
		submitted: OpenSettlementSubmitted[];
		/** Today in Buenos Aires (`aaaa-mm-dd`): the default and the latest payment date. */
		today: string;
		reasonMax: number;
		can: {
			add: boolean;
			remove: boolean;
			reviewSubmitted: boolean;
			close: boolean;
			correctPayment: boolean;
		};
		form: OpenSettlementForm | null;
	}
</script>

<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import {
		Alert,
		Badge,
		BondNumber,
		Button,
		Dialog,
		Disclosure,
		EmptyState,
		Field,
		Money,
		MoneySheet,
		Row,
		RowActions,
		RowList,
		SegmentedControl,
		StatusBadge,
		TaskBar,
		Textarea,
		TextInput
	} from '$lib/components/ui';
	import type { MoneySheetRow, RowAction } from '$lib/components/ui';
	import { unprocessedSubmittedMessage } from '$lib/copy';
	import { centsToDecimalString, formatMoneyInput, parseMoneyToCents } from '$lib/domain/money';
	import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '$lib/domain/payments';
	import {
		bondQueryNumber,
		cashToHandOverCents,
		findSalesByBondNumber,
		groupCandidatesBySale,
		installmentsLabel,
		selectedTotalCents,
		type CandidateSale
	} from '$lib/domain/settlement-entry';
	import { formatDate, formatMoney } from '$lib/format';

	/**
	 * The open settlement (UX plan PR 7): payments are entered by bond number, the totals sit beside
	 * the entry, every payment names its bond, and the rare actions ask for their reason in a dialog.
	 * It posts to the page's own actions with the same fields as before.
	 */
	let {
		campaignId,
		settlement,
		totals,
		payments,
		candidates,
		submitted,
		today,
		reasonMax,
		can,
		form
	}: OpenSettlementProps = $props();

	const collector = $derived(settlement.collectorName);
	const sales = $derived(groupCandidatesBySale(candidates));
	const methodOptions = [
		{ value: 'cash', label: PAYMENT_METHOD_LABELS.cash },
		{ value: 'transfer', label: PAYMENT_METHOD_LABELS.transfer }
	];
	const methodLabel = (method: string) => PAYMENT_METHOD_LABELS[method as PaymentMethod] ?? method;
	const pesos = (cents: number) => formatMoney(centsToDecimalString(cents));
	const day = (date: string) => (date === today ? 'hoy' : formatDate(date));
	const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
	const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

	// --- Entry by bond number -------------------------------------------------------------------
	let numberInput = $state<HTMLInputElement>();
	let query = $state('');
	let sale = $state<CandidateSale | null>(null);
	let problem = $state('');
	let checked = $state<Record<string, boolean>>({});
	let amounts = $state<Record<string, string>>({});
	let editAmounts = $state(false);
	let method = $state('cash');
	let adding = $state(false);

	const totalCents = $derived(sale ? selectedTotalCents(sale.installments, checked, amounts) : 0);
	const saleSummary = $derived.by(() => {
		if (!sale) return '';
		const debt = `Debe ${pesos(sale.debtCents)} en ${plural(sale.installments.length, 'cuota', 'cuotas')}`;
		return sale.overdueCents > 0 ? `${debt}, ${pesos(sale.overdueCents)} vencidos.` : `${debt}.`;
	});

	function clearSale() {
		sale = null;
		checked = {};
		amounts = {};
		editAmounts = false;
	}

	function find() {
		const wanted = bondQueryNumber(query);
		clearSale();
		if (wanted === null) {
			problem = 'Escribir el número del bono.';
			return;
		}
		const found = findSalesByBondNumber(sales, query);
		if (found.length === 1) {
			problem = '';
			sale = found[0];
			// The next installment to pay comes checked; the rest are one tap away.
			checked = { [found[0].installments[0].id]: true };
			amounts = Object.fromEntries(
				found[0].installments.map((item) => [item.id, formatMoneyInput(item.amount)])
			);
		} else if (found.length > 1) {
			problem = `Hay más de una venta de ${collector} con el bono ${wanted}. Revisar esas ventas antes de cargar el pago.`;
		} else {
			problem = `${collector} no tiene una venta con deuda para el bono ${wanted}. No se agregó ningún pago.`;
		}
	}

	function onNumberInput() {
		problem = '';
		// A different number is a different bond: never leave the previous one ready to be paid.
		if (sale && findSalesByBondNumber([sale], query).length === 0) clearSale();
	}

	function onNumberKey(event: KeyboardEvent) {
		if (event.key !== 'Enter' || sale) return;
		// First Enter finds; with the bond on screen, the next Enter submits the form.
		event.preventDefault();
		find();
	}

	const submitAdd: Parameters<typeof enhance>[1] = ({ cancel }) => {
		if (!sale) {
			cancel();
			find();
			return;
		}
		if (totalCents <= 0) {
			cancel();
			problem = 'Marcar al menos una cuota con un importe mayor que cero.';
			return;
		}
		adding = true;
		return async ({ result, update }) => {
			await update({ reset: false });
			adding = false;
			if (result.type === 'success') {
				query = '';
				problem = '';
				clearSale();
				numberInput?.focus();
			}
		};
	};

	const addError = (key: string) => (form?.form === 'add' ? form.errors?.[key]?.[0] : undefined);
	const paymentDate = $derived(
		form?.form === 'add' && typeof form.values?.paymentDate === 'string'
			? form.values.paymentDate
			: today
	);

	// --- Totals ---------------------------------------------------------------------------------
	/** A payment taken out of the settlement stays on record as annulled: it is listed apart. */
	const current = $derived(payments.filter((p) => p.status !== 'annulled'));
	const removed = $derived(payments.filter((p) => p.status === 'annulled'));
	const count = (wanted: string) => current.filter((p) => p.method === wanted).length;
	const sheetRows = $derived<MoneySheetRow[]>([
		{ label: `Efectivo (${plural(count('cash'), 'pago', 'pagos')})`, value: totals.totalCash },
		{
			label: `Transferencias (${plural(count('transfer'), 'pago', 'pagos')})`,
			value: totals.totalTransfer
		},
		{ label: 'Total cobrado', value: totals.totalAmount, kind: 'subtotal' },
		{
			label: 'Comisión que se queda el cobrador',
			value: totals.commissionPaidAmount,
			kind: 'deduction'
		},
		{ label: 'Neto para Bomberos', value: totals.netToFirefighters, kind: 'lead' }
	]);
	/** Reference amounts: what the close will generate, and what the collector already had in favour. */
	const sheetSecondary = $derived([
		{ label: 'Comisión preliminar', value: totals.commissionAmount },
		...(parseMoneyToCents(totals.collectorCreditBalance)
			? [{ label: 'Saldo a favor del cobrador', value: totals.collectorCreditBalance }]
			: [])
	]);
	const handOver = $derived(pesos(cashToHandOverCents(totals)));
	/** With cents, like every amount of the closing sheet. */
	const handOverExact = $derived(
		formatMoney(centsToDecimalString(cashToHandOverCents(totals)), { decimals: 'always' })
	);
	const pendingTotal = $derived(
		pesos(submitted.reduce((sum, row) => sum + (parseMoneyToCents(row.amount) ?? 0), 0))
	);

	// --- Close ----------------------------------------------------------------------------------
	let closeOpen = $state(false);
	const pending = $derived(submitted.length);
	const blocked = $derived(pending > 0);

	// --- Row actions: each asks for its reason in a dialog ----------------------------------------
	type Correction = 'remove' | 'annul';
	let correcting = $state<{ kind: Correction; payment: OpenSettlementPayment } | null>(null);
	let rejecting = $state<OpenSettlementSubmitted | null>(null);
	const reasonHint = $derived(`Obligatorio, hasta ${reasonMax} caracteres.`);
	const bondOf = (payment: { bond: string }) => (payment.bond ? `bono ${payment.bond}` : 'pago');

	const CORRECTIONS: Record<
		Correction,
		{ action: string; title: (bond: string) => string; description: string; confirm: string }
	> = {
		remove: {
			action: '?/remove',
			title: (bond) => `¿Quitar el pago del ${bond} de esta rendición?`,
			description: 'El pago deja de contar en los totales de esta rendición.',
			confirm: 'Quitar pago'
		},
		annul: {
			action: '?/annulPayment',
			title: (bond) => `¿Anular el pago del ${bond}?`,
			description:
				'La anulación revierte la comisión generada y, si fue en efectivo, acredita la comisión retenida. No se puede deshacer.',
			confirm: 'Anular pago'
		}
	};
	const correction = $derived(correcting ? CORRECTIONS[correcting.kind] : null);

	/**
	 * A payment waiting in an open settlement can only leave it: «Quitar» for whoever loads the
	 * settlement, «Anular» for whoever can only annul payments. Both ask for the reason. Changing the
	 * method or moving a transfer are corrections of confirmed payments: they live on the closed
	 * settlement.
	 */
	function rowActions(payment: OpenSettlementPayment): RowAction[] {
		if (payment.status !== 'pending_in_settlement') return [];
		const pick = (kind: Correction) => () => (correcting = { kind, payment });
		if (can.remove)
			return [{ label: 'Quitar de la rendición', onselect: pick('remove'), tone: 'danger' }];
		if (can.correctPayment)
			return [{ label: 'Anular el pago', onselect: pick('annul'), tone: 'danger' }];
		return [];
	}

	/** Runs the form with `enhance` and closes the dialog once the server has answered. */
	const closing = (close: () => void) => (node: HTMLFormElement) =>
		enhance(node, () => async ({ update }) => {
			await update();
			close();
		});

	const paymentTitle = (payment: OpenSettlementPayment) =>
		payment.buyer ?? (installmentsLabel(payment.installments) || methodLabel(payment.method));
	const paymentDetail = (payment: OpenSettlementPayment) => {
		const parts = [
			payment.buyer ? installmentsLabel(payment.installments) : '',
			payment.buyer || payment.installments.length ? methodLabel(payment.method) : '',
			day(payment.date)
		].filter(Boolean);
		return [parts[0], ...parts.slice(1).map(lowerFirst)].join(', ');
	};
</script>

{#snippet noPayments()}
	<EmptyState title="Todavía no hay pagos en esta rendición">
		{#if can.add}Escribir arriba el número del bono que pagó.{/if}
	</EmptyState>
{/snippet}

<div
	class="lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-8"
	data-open-settlement
>
	<div class="min-w-0 space-y-8">
		{#if form?.message}
			<Alert tone={form.success ? 'success' : 'danger'}>{form.message}</Alert>
		{/if}

		{#if can.add}
			<section
				aria-label="Agregar un pago"
				class="rounded-lg border border-border-strong bg-surface p-4 sm:p-5"
			>
				<form method="POST" action="?/add" use:enhance={submitAdd} data-payment-entry>
					<label for="bond-number" class="block text-label text-text"
						>Número del bono que pagó</label
					>
					<div class="mt-1.5 flex gap-2">
						<input
							id="bond-number"
							bind:this={numberInput}
							bind:value={query}
							oninput={onNumberInput}
							onkeydown={onNumberKey}
							type="text"
							inputmode="numeric"
							autocomplete="off"
							enterkeyhint="search"
							aria-describedby="bond-number-hint bond-number-status"
							aria-invalid={problem ? 'true' : undefined}
							class="h-14 min-w-0 flex-1 rounded-md border bg-surface px-3 font-figure text-[28px] leading-8 text-text tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus {problem
								? 'border-danger'
								: 'border-border-strong'}"
						/>
						<Button type="button" size="lg" class="h-14" onclick={find}>Buscar</Button>
					</div>
					<p id="bond-number-hint" class="m-0 mt-1.5 text-body-sm text-muted">
						{#if sales.length === 0}
							{collector} no tiene ventas con deuda en esta campaña.
						{:else}
							Solo los bonos que vendió {collector}. Enter busca; otro Enter agrega el pago.
						{/if}
					</p>
					<p
						id="bond-number-status"
						role="status"
						class="m-0 text-body-sm font-medium text-danger-text {problem ? 'mt-1.5' : ''}"
					>
						{problem}
					</p>

					{#if sale}
						<div class="mt-4 border-t border-border pt-4" data-found-sale>
							<input type="hidden" name="saleId" value={sale.saleId} />
							<p class="m-0 flex flex-wrap items-baseline gap-x-3 gap-y-1">
								<BondNumber number={sale.bond} size="md" />
								{#if sale.buyer}<strong class="text-body font-semibold">{sale.buyer}</strong>{/if}
							</p>
							<p class="m-0 mt-0.5 text-body-sm text-muted">{saleSummary}</p>

							<ul class="m-0 mt-2 list-none p-0" aria-label="Cuotas a las que se aplica el pago">
								{#each sale.installments as item (item.id)}
									<li class="flex min-h-touch items-center gap-3 border-b border-border py-1">
										<label
											class="flex min-h-touch min-w-0 flex-1 cursor-pointer items-center gap-3"
										>
											<input
												type="checkbox"
												name="installmentId"
												value={item.id}
												bind:checked={checked[item.id]}
												class="size-5 shrink-0 accent-primary"
											/>
											<span class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
												<span class="text-body">Cuota {item.number}</span>
												<StatusBadge kind="installment" status={item.status as never} />
												<span class="text-body-sm text-muted"
													>vence el {formatDate(item.dueDate)}</span
												>
											</span>
										</label>
										{#if editAmounts && checked[item.id]}
											<TextInput
												name="amount-{item.id}"
												bind:value={amounts[item.id]}
												inputmode="decimal"
												aria-label="Importe para la cuota {item.number}"
												class="w-28 text-right tabular-nums"
											/>
										{:else}
											<input type="hidden" name="amount-{item.id}" value={item.amount} />
											<Money value={item.amount} class="shrink-0 text-body font-medium" />
										{/if}
									</li>
								{/each}
							</ul>
							{#if addError('installmentId')}
								<p class="m-0 mt-1.5 text-body-sm font-medium text-danger-text">
									{addError('installmentId')}
								</p>
							{/if}
							{#each sale.installments as item (item.id)}
								{#if addError(`amount-${item.id}`)}
									<p class="m-0 mt-1.5 text-body-sm font-medium text-danger-text">
										Cuota {item.number}: {addError(`amount-${item.id}`)}
									</p>
								{/if}
							{/each}
							{#if !editAmounts}
								<button
									type="button"
									class="mt-1 inline-flex min-h-touch items-center rounded-sm text-body-sm text-primary-text underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
									onclick={() => (editAmounts = true)}>Pagó otro importe</button
								>
							{/if}

							<div class="mt-3 grid gap-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-end">
								<Field
									label="Fecha del pago"
									id="paymentDate"
									required
									error={addError('paymentDate')}
								>
									<TextInput
										name="paymentDate"
										type="date"
										value={paymentDate}
										max={today}
										required
									/>
								</Field>
								<SegmentedControl
									legend="Método de pago"
									name="paymentMethod"
									options={methodOptions}
									bind:value={method}
								/>
							</div>
							<Button
								type="submit"
								variant="primary"
								size="lg"
								block
								class="mt-4"
								disabled={adding}
								data-add-payment
							>
								{totalCents > 0 ? `Agregar pago de ${pesos(totalCents)}` : 'Agregar pago'}
							</Button>
						</div>
					{/if}
				</form>
			</section>
		{/if}

		{#if submitted.length}
			<section aria-labelledby="submitted-title" id="submitted-payments">
				<div
					class="flex flex-wrap items-center justify-between gap-2 border-b border-border-strong pb-2"
				>
					<h2 id="submitted-title" class="m-0 text-heading-3 text-text">
						Cobros que envió {collector}
					</h2>
					{#if pending > 0}<Badge tone="warning">{pending} sin procesar</Badge>{/if}
				</div>
				{#if submitted.length}
					<p class="m-0 mt-2 text-body-sm text-muted">
						No cuentan en los totales hasta que se incluyan: suman {pendingTotal}. Para cerrar la
						rendición hay que incluir o rechazar cada uno.
					</p>
					<ul class="m-0 list-none p-0">
						{#each submitted as row (row.id)}
							<li class="border-b border-border py-3" data-submitted-row>
								<div class="flex items-baseline justify-between gap-3">
									<p class="m-0 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
										{#if row.bond}<BondNumber number={row.bond} size="sm" />{/if}
										<span class="text-body">
											<strong class="font-semibold">{row.buyer}</strong
											>{#if row.installments.length}, {lowerFirst(
													installmentsLabel(row.installments)
												)}{/if}
										</span>
									</p>
									<Money value={row.amount} class="shrink-0 text-body font-medium" />
								</div>
								<p class="m-0 mt-0.5 text-body-sm text-muted">
									{methodLabel(row.method)}, cobrado {row.date === today
										? 'hoy'
										: `el ${formatDate(row.date)}`}.{#if row.note}
										Nota del cobrador: «{row.note}».{/if}
								</p>
								{#if can.reviewSubmitted}
									<div class="mt-2 flex flex-wrap gap-2">
										<form method="POST" action="?/includeSubmitted" use:enhance>
											<input type="hidden" name="paymentId" value={row.id} />
											<Button type="submit" variant="primary">Incluir en la rendición</Button>
										</form>
										<Button onclick={() => (rejecting = row)}>Rechazar</Button>
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}

		<section aria-labelledby="payments-title">
			<div class="flex items-baseline justify-between gap-2 border-b border-border-strong pb-2">
				<h2 id="payments-title" class="m-0 text-heading-3 text-text">Pagos de esta rendición</h2>
				{#if current.length}
					<p class="m-0 text-body-sm text-muted">{plural(current.length, 'pago', 'pagos')}</p>
				{/if}
			</div>
			<RowList label="Pagos de esta rendición" empty={current.length ? undefined : noPayments}>
				{#each current as payment (payment.id)}
					{@const menu = rowActions(payment)}
					<Row title={paymentTitle(payment)} detail={paymentDetail(payment)}>
						{#snippet lead()}
							{#if payment.bond}
								<BondNumber
									number={payment.bond}
									size="md"
									href={payment.bondId
										? resolve('/campaigns/[id]/bonds/[bondId]', {
												id: campaignId,
												bondId: payment.bondId
											})
										: undefined}
								/>
							{/if}
						{/snippet}
						{#snippet trailing()}
							<Money value={payment.amount} class="text-body font-medium" />
						{/snippet}
						{#snippet actions()}
							{#if menu.length}
								<RowActions label="Acciones del pago del {bondOf(payment)}" actions={menu} />
							{/if}
						{/snippet}
					</Row>
				{/each}
			</RowList>
			{#if removed.length}
				<div class="mt-3">
					<Disclosure summary={plural(removed.length, 'pago quitado', 'pagos quitados')}>
						<RowList label="Pagos quitados de esta rendición">
							{#each removed as payment (payment.id)}
								<Row title={paymentTitle(payment)}>
									{#snippet lead()}
										{#if payment.bond}<BondNumber number={payment.bond} size="sm" />{/if}
									{/snippet}
									{#snippet meta()}
										<StatusBadge kind="payment" status="annulled" />
										<span>{paymentDetail(payment)}</span>
									{/snippet}
									{#snippet trailing()}
										<Money value={payment.amount} class="text-body-sm text-muted line-through" />
									{/snippet}
								</Row>
							{/each}
						</RowList>
					</Disclosure>
				</div>
			{/if}
		</section>
	</div>

	<aside
		aria-labelledby="totals-title"
		class="mt-8 rounded-lg border border-border bg-surface p-5 lg:sticky lg:top-20 lg:mt-0"
		data-settlement-totals
	>
		<h2 id="totals-title" class="m-0 mb-1 text-heading-3 text-text">Hasta ahora</h2>
		<MoneySheet rows={sheetRows} secondary={sheetSecondary} />
		<p class="m-0 mt-4 rounded-md bg-primary-soft px-4 py-3 text-body text-primary-text">
			{collector} tiene que entregar <strong class="font-semibold">{handOver}</strong> en efectivo.
		</p>
		{#if can.close}
			<div class="mt-4 hidden lg:block">
				<Button
					variant="primary"
					size="lg"
					block
					disabled={blocked}
					aria-describedby={blocked ? 'close-blocked' : undefined}
					onclick={() => (closeOpen = true)}>Cerrar rendición</Button
				>
			</div>
		{/if}
		{#if blocked}
			<p id="close-blocked" class="m-0 mt-2 text-body-sm text-muted">
				{unprocessedSubmittedMessage(pending)}
			</p>
		{/if}
	</aside>
</div>

{#if can.close}
	<div class="lg:hidden">
		<TaskBar label="Cierre de la rendición">
			<p class="m-0 text-body-sm text-muted">Entrega en efectivo</p>
			<p class="m-0 font-figure text-figure tabular-nums">{handOver}</p>
			{#snippet action()}
				{#if blocked}
					<Button href="#submitted-payments" variant="primary" size="lg"
						>Ver {plural(pending, 'cobro', 'cobros')} sin procesar</Button
					>
				{:else}
					<Button variant="primary" size="lg" onclick={() => (closeOpen = true)}
						>Revisar y cerrar</Button
					>
				{/if}
			{/snippet}
		</TaskBar>
	</div>

	<Dialog
		open={closeOpen}
		onClose={() => (closeOpen = false)}
		action="?/close"
		title="¿Cerrar la rendición {settlement.settlementNumber} de {collector}?"
		description="Cerrar confirma los pagos, la comisión y los movimientos de la cuenta corriente. Una rendición cerrada no se reabre."
		confirmLabel="Cerrar rendición"
	>
		<MoneySheet context="document" rows={sheetRows} secondary={sheetSecondary} />
		<p class="m-0 rounded-md bg-primary-soft px-4 py-3 text-body text-primary-text">
			{collector} entrega <strong class="font-semibold">{handOverExact}</strong> en efectivo.
		</p>
	</Dialog>
{/if}

{#if correcting && correction}
	{@const payment = correcting.payment}
	<Dialog
		open
		onClose={() => (correcting = null)}
		action={correction.action}
		enhance={closing(() => (correcting = null))}
		title={correction.title(bondOf(payment))}
		description={correction.description}
		confirmLabel={correction.confirm}
		tone="danger"
	>
		<input type="hidden" name="paymentId" value={payment.id} />
		<p class="m-0 text-body">
			{#if payment.buyer}{payment.buyer},
			{/if}<Money value={payment.amount} />, {lowerFirst(methodLabel(payment.method))}, {day(
				payment.date
			)}.
		</p>
		<Field label="Motivo" id="correction-reason" required hint={reasonHint}>
			<Textarea name="reason" required />
		</Field>
	</Dialog>
{/if}

{#if rejecting}
	{@const row = rejecting}
	<Dialog
		open
		onClose={() => (rejecting = null)}
		action="?/rejectSubmitted"
		enhance={closing(() => (rejecting = null))}
		title="¿Rechazar el cobro {row.bond ? `del bono ${row.bond}` : 'enviado'}?"
		description="El cobro no entra en la rendición y {collector} ve el motivo en su portal."
		confirmLabel="Rechazar cobro"
		tone="danger"
	>
		<input type="hidden" name="paymentId" value={row.id} />
		<p class="m-0 text-body">
			{row.buyer}, <Money value={row.amount} />, {lowerFirst(methodLabel(row.method))}.
		</p>
		<Field label="Motivo del rechazo" id="reject-reason" required hint={reasonHint}>
			<Textarea name="reason" required />
		</Field>
	</Dialog>
{/if}

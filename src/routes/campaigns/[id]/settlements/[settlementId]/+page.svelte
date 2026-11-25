<script lang="ts">
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import {
		Alert,
		Button,
		Card,
		Dialog,
		Disclosure,
		EmptyState,
		Field,
		PageHeader,
		Select,
		Stat,
		StatusBadge,
		Table,
		Textarea,
		TextInput
	} from '$lib/components/ui';
	import type { TableColumn } from '$lib/components/ui';
	import { unprocessedSubmittedMessage } from '$lib/copy';
	import { formatDate, formatDateTime, formatMoney } from '$lib/format';
	import { parseMoneyToCents } from '$lib/domain/money';
	import {
		PAYMENT_METHOD_LABELS,
		type PaymentMethod,
		type PaymentStatus
	} from '$lib/domain/payments';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let saleId = $state('');
	let commissionDelta = $state('0.00');
	let cashRetainedDelta = $state('0.00');
	let closeOpen = $state(false);
	const selected = $derived(data.candidates.filter((x) => x.saleId === saleId));
	const saleOptions = $derived([
		{ value: '', label: 'Elegir un bono o comprador…' },
		...data.candidates
			.filter((c, i, all) => all.findIndex((x) => x.saleId === c.saleId) === i)
			.map((c) => ({ value: c.saleId, label: `Bono ${c.bond} — ${c.buyer}` }))
	]);
	const methodOptions = [
		{ value: 'cash', label: PAYMENT_METHOD_LABELS.cash },
		{ value: 'transfer', label: PAYMENT_METHOD_LABELS.transfer }
	];
	const money = (value: string | number) => formatMoney(value, { decimals: 'always' });
	const annulled = $derived(data.settlement.status === 'annulled');
	const metrics = $derived(
		annulled
			? [
					{ label: 'Efectivo registrado', value: data.totals.totalCash },
					{ label: 'Transferencias registradas', value: data.totals.totalTransfer },
					{ label: 'Total registrado', value: data.totals.totalAmount }
				]
			: [
					{ label: 'Total en efectivo', value: data.totals.totalCash },
					{ label: 'Total en transferencias', value: data.totals.totalTransfer },
					{ label: 'Total general', value: data.totals.totalAmount },
					{
						// Closed (or closed and later corrected) settlements generated their commission.
						label: ['closed', 'corrected'].includes(data.settlement.status)
							? 'Comisión generada'
							: 'Comisión preliminar',
						value: data.totals.commissionAmount
					},
					{ label: 'Comisión retenida ahora', value: data.totals.commissionPaidAmount },
					{ label: 'Neto para Bomberos', value: data.totals.netToFirefighters },
					{ label: 'Saldo a favor del cobrador', value: data.totals.collectorCreditBalance }
				]
	);
	const open = $derived(data.settlement.status === 'open');
	/** Collector-submitted payments nobody has included or rejected: they block the close (SAN-156). */
	const pendingSubmitted = $derived(open ? data.submitted.length : 0);
	const pendingSubmittedTotal = $derived(
		money(data.submitted.reduce((sum, p) => sum + cents(p.amount), 0) / 100)
	);
	/** Closed (or closed and corrected) settlements read as a cash sheet (redesign). */
	const sheet = $derived(['closed', 'corrected'].includes(data.settlement.status));
	const cents = (value: string | number) => parseMoneyToCents(String(value)) ?? 0;
	const confirmedCount = (method: PaymentMethod) =>
		data.payments.filter((p) => p.method === method && p.status === 'confirmed').length;
	const pagos = (n: number) => (n === 1 ? '1 pago' : `${n} pagos`);
	const meta = $derived(
		sheet && data.settlement.closedAt
			? `${data.settlement.collectorName}, cerrada el ${formatDateTime(data.settlement.closedAt)}`
			: `${data.settlement.collectorName}, abierta el ${formatDate(data.settlement.openedAt)}`
	);
	type Payment = (typeof data.payments)[number];
	const columns = $derived<TableColumn<Payment>[]>([
		{ key: 'date', header: 'Fecha' },
		{ key: 'amount', header: 'Importe', align: 'right' },
		{ key: 'method', header: 'Método' },
		{ key: 'status', header: 'Estado' },
		...(open ? [] : [{ key: 'document', header: 'Comprobante' }]),
		...(data.can.remove || data.can.correctPayment ? [{ key: 'actions', header: 'Acciones' }] : [])
	]);
	type Submitted = (typeof data.submitted)[number];
	const submittedColumns = $derived<TableColumn<Submitted>[]>([
		{ key: 'date', header: 'Fecha' },
		{ key: 'sale', header: 'Venta' },
		{ key: 'installments', header: 'Cuotas' },
		{ key: 'amount', header: 'Importe', align: 'right' },
		{ key: 'method', header: 'Método' },
		{ key: 'note', header: 'Nota' },
		...(data.can.reviewSubmitted ? [{ key: 'actions', header: 'Acciones' }] : [])
	]);
	const reasonHint = $derived(`Hasta ${data.reasonMax} caracteres.`);
	const ledgerPreview = $derived(
		`Comisión: ${Number(commissionDelta) >= 0 ? 'crédito' : 'débito'} de ${money(
			Math.abs(Number(commissionDelta) || 0)
		)}; efectivo retenido: ${Number(cashRetainedDelta) >= 0 ? 'débito' : 'crédito'} de ${money(
			Math.abs(Number(cashRetainedDelta) || 0)
		)}.`
	);
</script>

{#snippet correctionForm()}
	<form method="POST" action="?/correctSettlement" class="space-y-4">
		<div class="grid gap-4 sm:grid-cols-2">
			<Field label="Diferencia de comisión" id="commissionDelta">
				<TextInput name="commissionDelta" bind:value={commissionDelta} class="tabular-nums" />
			</Field>
			<Field label="Diferencia de comisión retenida en efectivo" id="cashRetainedDelta">
				<TextInput name="cashRetainedDelta" bind:value={cashRetainedDelta} class="tabular-nums" />
			</Field>
		</div>
		<Alert tone="info" title="Vista indicativa del libro">
			{ledgerPreview} La validación numérica de la base de datos y los movimientos registrados son los
			que valen.
		</Alert>
		<Field label="Motivo" id="settlement-correction-reason" required hint={reasonHint}>
			<Textarea name="reason" />
		</Field>
		<Button type="submit" variant="primary">Registrar corrección</Button>
	</form>
{/snippet}

<svelte:head
	><title>Rendición {data.settlement.settlementNumber} - {data.campaign.name}</title></svelte:head
>

<PageHeader
	title="Rendición #{data.settlement.settlementNumber}"
	description={meta}
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: data.campaign.name, href: resolve('/campaigns/[id]', { id: data.campaign.id }) },
		{
			label: 'Rendiciones',
			href: resolve('/campaigns/[id]/settlements', { id: data.campaign.id })
		},
		{ label: `#${data.settlement.settlementNumber}` }
	]}
>
	{#snippet actions()}
		<StatusBadge kind="settlement" status={data.settlement.status} />
		{#if data.can.close}
			<Button
				variant="danger"
				disabled={pendingSubmitted > 0}
				aria-describedby={pendingSubmitted > 0 ? 'close-blocked' : undefined}
				onclick={() => (closeOpen = true)}>Cerrar rendición</Button
			>
		{/if}
	{/snippet}
</PageHeader>

<div class="space-y-6">
	{#if form?.message}
		<Alert tone={form.success ? 'success' : 'danger'}>{form.message}</Alert>
	{/if}

	{#if pendingSubmitted > 0}
		<Alert
			tone="warning"
			title={pendingSubmitted === 1
				? '1 cobro enviado sin procesar'
				: `${pendingSubmitted} cobros enviados sin procesar`}
		>
			<span id="close-blocked">
				{unprocessedSubmittedMessage(pendingSubmitted)} Importe pendiente: {pendingSubmittedTotal}.
			</span>
		</Alert>
	{/if}

	{#if sheet}
		<!-- Redesign: a closed settlement reads like a cash sheet, top to bottom. -->
		<section
			aria-labelledby="sheet-title"
			class="max-w-[560px] rounded-lg border border-border bg-surface px-6 pt-2 pb-5"
		>
			<h2 id="sheet-title" class="sr-only">Totales de la rendición</h2>
			<dl class="m-0 tabular-nums">
				<div class="flex justify-between gap-3 py-2.5">
					<dt>Efectivo recibido ({pagos(confirmedCount('cash'))})</dt>
					<dd class="m-0 font-medium whitespace-nowrap">{money(data.totals.totalCash)}</dd>
				</div>
				<div class="flex justify-between gap-3 py-2.5">
					<dt>Transferencias ({pagos(confirmedCount('transfer'))})</dt>
					<dd class="m-0 font-medium whitespace-nowrap">{money(data.totals.totalTransfer)}</dd>
				</div>
				<div class="flex justify-between gap-3 border-t border-border-strong py-2.5 font-semibold">
					<dt>Total cobrado</dt>
					<dd class="m-0 whitespace-nowrap">{money(data.totals.totalAmount)}</dd>
				</div>
				<div class="flex justify-between gap-3 py-2.5 text-muted">
					<dt>Comisión que el cobrador se quedó del efectivo</dt>
					<dd class="m-0 whitespace-nowrap">
						<span aria-hidden="true">−</span><span class="sr-only">menos</span>
						{money(data.totals.commissionPaidAmount)}
					</dd>
				</div>
				<div
					class="mt-1 flex items-baseline justify-between gap-3 border-t-[3px] border-double border-text pt-3.5"
				>
					<dt class="text-body font-semibold">Neto para Bomberos</dt>
					<dd class="m-0 font-figure text-figure-lg whitespace-nowrap">
						{money(data.totals.netToFirefighters)}
					</dd>
				</div>
			</dl>
			<dl class="m-0 mt-3 grid gap-1 text-body-sm text-muted tabular-nums">
				<div class="flex justify-between gap-3">
					<dt>Comisión generada</dt>
					<dd class="m-0 whitespace-nowrap">{money(data.totals.commissionAmount)}</dd>
				</div>
				{#if cents(data.totals.collectorCreditBalance) !== 0}
					<div class="flex justify-between gap-3">
						<dt>Saldo a favor del cobrador</dt>
						<dd class="m-0 whitespace-nowrap">{money(data.totals.collectorCreditBalance)}</dd>
					</div>
				{/if}
			</dl>
			{#if data.settlement.status === 'corrected'}
				<p class="m-0 mt-3 text-body-sm text-warning-text">
					Esta rendición tiene una corrección registrada. Los totales de arriba son los del cierre;
					la corrección y sus movimientos están en la cuenta corriente del cobrador.
				</p>
			{/if}
			<div class="mt-4 flex flex-wrap gap-2">
				<Button
					variant="primary"
					href={resolve(`/campaigns/${data.campaign.id}/settlements/${data.settlement.id}/print`)}
					>Imprimir remito de rendición</Button
				>
				{#if data.can.viewLedger}
					<Button
						href={resolve('/campaigns/[id]/collectors/[collectorId]/ledger', {
							id: data.campaign.id,
							collectorId: data.settlement.collectorId
						})}>Ver cuenta corriente de {data.settlement.collectorName}</Button
					>
				{/if}
			</div>
			{#if data.can.correctSettlement}
				<div class="mt-4 border-t border-border pt-3">
					<Disclosure summary="Corregir esta rendición">
						<p class="m-0 mb-3 text-body-sm text-muted">
							La rendición cerrada no se edita: se registra una corrección con motivo, que queda en
							la cuenta corriente.
						</p>
						{@render correctionForm()}
					</Disclosure>
				</div>
			{/if}
		</section>
	{:else}
		{#if annulled}
			<Alert tone="warning" title="Rendición anulada">
				Sus pagos, su comisión y sus movimientos no cuentan. Se muestran solo los importes que se
				habían registrado.
			</Alert>
		{/if}
		<section aria-label="Totales" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			{#each metrics as item (item.label)}
				<Stat label={item.label} value={money(item.value)} />
			{/each}
		</section>
		{#if !open}
			<Card title="Documentos de la rendición">
				<Button
					href={resolve(`/campaigns/${data.campaign.id}/settlements/${data.settlement.id}/print`)}
					>Imprimir remito de rendición</Button
				>
			</Card>
		{/if}
	{/if}
	{#if open && (data.submitted.length || data.can.reviewSubmitted)}
		<Card
			title={pendingSubmitted > 0
				? `Cobros enviados por el cobrador: ${pendingSubmitted} sin procesar`
				: 'Cobros enviados por el cobrador'}
			id="submitted-payments"
			flush
		>
			<p class="m-0 px-4 pt-3 text-body-sm text-muted">
				Los cobros que el cobrador registró desde su portal no cuentan en los totales hasta que se
				incluyan en esta rendición y se cierre. Mientras haya alguno sin procesar no se puede cerrar
				la rendición: incluya cada cobro o recházelo con un motivo.
			</p>
			<Table
				columns={submittedColumns}
				rows={data.submitted}
				caption="Cobros enviados por el cobrador"
			>
				{#snippet cell({ row, column })}
					{#if column.key === 'date'}
						{formatDate(row.date)}
					{:else if column.key === 'sale'}
						Bono {row.bond || '—'} · {row.buyer}
					{:else if column.key === 'installments'}
						{row.installments.join(', ') || '—'}
					{:else if column.key === 'amount'}
						<span class="tabular-nums">{money(row.amount)}</span>
					{:else if column.key === 'method'}
						{PAYMENT_METHOD_LABELS[row.method as PaymentMethod] ?? row.method}
					{:else if column.key === 'note'}
						{row.note ?? '—'}
					{:else if column.key === 'actions'}
						{#if data.can.reviewSubmitted}
							<div class="space-y-2">
								<form method="POST" action="?/includeSubmitted" use:enhance>
									<input type="hidden" name="paymentId" value={row.id} />
									<Button type="submit" variant="primary">Incluir en la rendición</Button>
								</form>
								<form
									method="POST"
									action="?/rejectSubmitted"
									use:enhance
									class="flex items-end gap-2"
								>
									<input type="hidden" name="paymentId" value={row.id} />
									<TextInput
										name="reason"
										required
										aria-label="Motivo del rechazo (obligatorio, hasta {data.reasonMax} caracteres)"
										placeholder="Motivo del rechazo"
									/>
									<Button type="submit">Rechazar</Button>
								</form>
							</div>
						{/if}
					{/if}
				{/snippet}
				{#snippet empty()}
					<EmptyState title="No hay cobros enviados por el cobrador" />
				{/snippet}
			</Table>
		</Card>
	{/if}
	{#if open && data.can.add}
		<Card title="Carga rápida de pagos">
			<form method="POST" action="?/add" use:enhance class="space-y-4">
				<Field label="Bono / comprador" id="sale" required>
					<Select name="saleId" options={saleOptions} bind:value={saleId} />
				</Field>
				{#if selected.length}
					<div class="overflow-x-auto">
						<table class="w-full border-collapse text-body-sm">
							<caption class="sr-only">Cuotas a las que se aplica el pago</caption>
							<thead>
								<tr class="border-b border-border text-left text-label text-muted">
									<th scope="col" class="px-3 py-2">Aplicar</th>
									<th scope="col" class="px-3 py-2">Cuota</th>
									<th scope="col" class="px-3 py-2">Vence</th>
									<th scope="col" class="px-3 py-2 text-right">Importe</th>
								</tr>
							</thead>
							<tbody>
								{#each selected as item (item.id)}
									<tr class="border-b border-border last:border-b-0">
										<td class="px-3 py-2">
											<input
												type="checkbox"
												name="installmentId"
												value={item.id}
												aria-label="Aplicar a la cuota {item.number}"
												class="size-5 accent-primary"
											/>
										</td>
										<td class="px-3 py-2"
											>{item.number}
											<StatusBadge kind="installment" status={item.status as never} /></td
										>
										<td class="px-3 py-2">{formatDate(item.dueDate)}</td>
										<td class="px-3 py-2 text-right">
											<TextInput
												name="amount-{item.id}"
												value={item.amount}
												aria-label="Importe para la cuota {item.number}"
												class="text-right tabular-nums"
											/>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
				<Field label="Método" id="paymentMethod">
					<Select name="paymentMethod" options={methodOptions} value="cash" />
				</Field>
				<Button type="submit" variant="primary" icon="plus">Agregar pago</Button>
			</form>
		</Card>
	{/if}

	<Table {columns} rows={data.payments} caption="Pagos de la rendición">
		{#snippet cell({ row, column })}
			{#if column.key === 'date'}
				{formatDate(row.date)}
			{:else if column.key === 'amount'}
				<span class="tabular-nums">{money(row.amount)}</span>
			{:else if column.key === 'method'}
				{PAYMENT_METHOD_LABELS[row.method as PaymentMethod] ?? row.method}
			{:else if column.key === 'status'}
				<StatusBadge kind="payment" status={row.status as PaymentStatus} />
			{:else if column.key === 'document'}
				{#if row.status === 'confirmed'}
					<a
						class="rounded-sm text-primary-text underline-offset-2 hover:underline"
						href={resolve(`/campaigns/${data.campaign.id}/payments/${row.id}/print`)}>Comprobante</a
					>
				{:else}—{/if}
			{:else if column.key === 'actions'}
				<div class="space-y-2">
					{#if data.can.remove}
						<form method="POST" action="?/remove" class="flex items-end gap-2">
							<input type="hidden" name="paymentId" value={row.id} />
							<TextInput
								name="reason"
								aria-label="Motivo obligatorio (hasta {data.reasonMax} caracteres)"
								placeholder="Motivo obligatorio"
							/>
							<Button type="submit">Quitar</Button>
						</form>
					{/if}
					{#if data.can.correctPayment}
						<Disclosure summary="Corregir / anular">
							<div class="space-y-4">
								<Alert tone="info">
									<strong>Vista indicativa:</strong> la base de datos es la que decide. La anulación revierte
									la comisión generada y, en efectivo, acredita la comisión retenida. La corrección de
									método registra solo la diferencia de la retención en efectivo.
								</Alert>
								<form method="POST" action="?/annulPayment" class="space-y-3">
									<input type="hidden" name="paymentId" value={row.id} />
									<Field
										label="Motivo de la anulación"
										id="annul-reason-{row.id}"
										required
										hint={reasonHint}
									>
										<Textarea name="reason" />
									</Field>
									<Button type="submit" variant="danger">Anular pago</Button>
								</form>
								<form method="POST" action="?/correctPaymentMethod" class="space-y-3">
									<input type="hidden" name="paymentId" value={row.id} />
									<Field label="Método correcto" id="method-{row.id}">
										<Select name="newMethod" options={methodOptions} value="cash" />
									</Field>
									<Field label="Motivo" id="method-reason-{row.id}" required hint={reasonHint}>
										<Textarea name="reason" />
									</Field>
									<Button type="submit">Confirmar corrección de método</Button>
								</form>
								{#if row.method === 'transfer'}
									<form method="POST" action="?/reassociateTransfer" class="space-y-3">
										<input type="hidden" name="paymentId" value={row.id} />
										<Field label="Venta / cuota de destino" id="destination-{row.id}" required>
											<Select
												name="installmentId"
												options={[
													{ value: '', label: 'Elegir…' },
													...data.candidates.map((candidate) => ({
														value: candidate.id,
														label: `${candidate.bond} — ${candidate.buyer} — cuota ${candidate.number} — resta ${money(candidate.amount)}`
													}))
												]}
											/>
										</Field>
										<Field
											label="Id de la venta de destino"
											id="destination-sale-{row.id}"
											required
										>
											<TextInput name="newSaleId" mono />
										</Field>
										<Field label="Importe aplicado" id="destination-amount-{row.id}" required>
											<TextInput name="amountApplied" value={row.amount} class="tabular-nums" />
										</Field>
										<Field
											label="Motivo"
											id="destination-reason-{row.id}"
											required
											hint={reasonHint}
										>
											<Textarea name="reason" />
										</Field>
										<Button type="submit">Confirmar reasociación</Button>
									</form>
								{/if}
							</div>
						</Disclosure>
					{/if}
				</div>
			{/if}
		{/snippet}
		{#snippet empty()}
			<EmptyState title="Todavía no hay pagos registrados" />
		{/snippet}
	</Table>

	{#if data.can.correctSettlement && !sheet}
		<Card
			title="Corregir la rendición cerrada"
			description="Crea una corrección inmutable; los totales originales no se editan."
		>
			{@render correctionForm()}
		</Card>
	{/if}

	{#if data.can.close}
		<Dialog
			open={closeOpen}
			onClose={() => (closeOpen = false)}
			action="?/close"
			title="Cerrar la rendición #{data.settlement.settlementNumber}"
			description="Cerrar confirma los pagos, la comisión y los movimientos de la cuenta corriente. Una rendición cerrada no se reabre."
			confirmLabel="Cerrar rendición"
			tone="danger"
		>
			<dl class="grid gap-2 text-body sm:grid-cols-2">
				<div class="flex justify-between gap-4 sm:block">
					<dt class="text-muted">Total en efectivo</dt>
					<dd class="tabular-nums">{money(data.totals.totalCash)}</dd>
				</div>
				<div class="flex justify-between gap-4 sm:block">
					<dt class="text-muted">Total en transferencias</dt>
					<dd class="tabular-nums">{money(data.totals.totalTransfer)}</dd>
				</div>
				<div class="flex justify-between gap-4 sm:block">
					<dt class="text-muted">Total general</dt>
					<dd class="tabular-nums font-semibold">{money(data.totals.totalAmount)}</dd>
				</div>
				<div class="flex justify-between gap-4 sm:block">
					<dt class="text-muted">Comisión</dt>
					<dd class="tabular-nums">{money(data.totals.commissionAmount)}</dd>
				</div>
				<div class="flex justify-between gap-4 sm:block">
					<dt class="text-muted">Neto para Bomberos</dt>
					<dd class="tabular-nums">{money(data.totals.netToFirefighters)}</dd>
				</div>
			</dl>
		</Dialog>
	{/if}
</div>

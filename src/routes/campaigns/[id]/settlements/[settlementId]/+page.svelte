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
	import { formatDate, formatMoney } from '$lib/format';
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
	const metrics = $derived([
		{ label: 'Total en efectivo', value: data.totals.totalCash },
		{ label: 'Total en transferencias', value: data.totals.totalTransfer },
		{ label: 'Total general', value: data.totals.totalAmount },
		{ label: 'Comisión preliminar', value: data.totals.commissionAmount },
		{ label: 'Comisión retenida ahora', value: data.totals.commissionPaidAmount },
		{ label: 'Neto para Bomberos', value: data.totals.netToFirefighters },
		{ label: 'Saldo a favor del cobrador', value: data.totals.collectorCreditBalance }
	]);
	const open = $derived(data.settlement.status === 'open');
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

<svelte:head
	><title>Rendición {data.settlement.settlementNumber} - {data.campaign.name}</title></svelte:head
>

<PageHeader
	title="Rendición #{data.settlement.settlementNumber}"
	description="{data.settlement.collectorName} · abierta el {formatDate(data.settlement.openedAt)}"
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
		{#if data.can.close}
			<Button variant="danger" onclick={() => (closeOpen = true)}>Cerrar rendición</Button>
		{/if}
	{/snippet}
</PageHeader>

<div class="space-y-6">
	<div><StatusBadge kind="settlement" status={data.settlement.status} /></div>
	{#if form?.message}
		<Alert tone={form.success ? 'success' : 'danger'}>{form.message}</Alert>
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
	{#if open && (data.submitted.length || data.can.reviewSubmitted)}
		<Card title="Cobros enviados por el cobrador" flush>
			<p class="m-0 px-4 pt-3 text-body-sm text-muted">
				Los cobros que el cobrador registró desde su portal no cuentan en los totales hasta que los
				incluyas en esta rendición y la cierres.
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

	{#if data.can.correctSettlement}
		<Card
			title="Corregir la rendición cerrada"
			description="Crea una corrección inmutable; los totales originales no se editan."
		>
			<form method="POST" action="?/correctSettlement" class="space-y-4">
				<div class="grid gap-4 sm:grid-cols-2">
					<Field label="Diferencia de comisión" id="commissionDelta">
						<TextInput name="commissionDelta" bind:value={commissionDelta} class="tabular-nums" />
					</Field>
					<Field label="Diferencia de comisión retenida en efectivo" id="cashRetainedDelta">
						<TextInput
							name="cashRetainedDelta"
							bind:value={cashRetainedDelta}
							class="tabular-nums"
						/>
					</Field>
				</div>
				<Alert tone="info" title="Vista indicativa del libro">
					{ledgerPreview} La validación numérica de la base de datos y los movimientos registrados son
					los que valen.
				</Alert>
				<Field label="Motivo" id="settlement-correction-reason" required hint={reasonHint}>
					<Textarea name="reason" />
				</Field>
				<Button type="submit" variant="primary">Registrar corrección</Button>
			</form>
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

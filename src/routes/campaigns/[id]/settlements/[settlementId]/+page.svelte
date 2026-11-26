<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		Alert,
		Button,
		Card,
		Disclosure,
		EmptyState,
		Field,
		MoneySheet,
		PageHeader,
		Select,
		Stat,
		StatusBadge,
		Table,
		Textarea,
		TextInput
	} from '$lib/components/ui';
	import type { MoneySheetRow, TableColumn } from '$lib/components/ui';
	import { formatDate, formatDateTime, formatMoney } from '$lib/format';
	import { parseMoneyToCents } from '$lib/domain/money';
	import {
		PAYMENT_METHOD_LABELS,
		type PaymentMethod,
		type PaymentStatus
	} from '$lib/domain/payments';
	import OpenSettlement, {
		type OpenSettlementForm,
		type OpenSettlementTotals
	} from '$lib/components/settlements/OpenSettlement.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let commissionDelta = $state('0.00');
	let cashRetainedDelta = $state('0.00');
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
	/** Closed (or closed and corrected) settlements read as a cash sheet (redesign). */
	const sheet = $derived(['closed', 'corrected'].includes(data.settlement.status));
	const cents = (value: string | number) => parseMoneyToCents(String(value)) ?? 0;
	const confirmedCount = (method: PaymentMethod) =>
		data.payments.filter((p) => p.method === method && p.status === 'confirmed').length;
	const pagos = (n: number) => (n === 1 ? '1 pago' : `${n} pagos`);
	/** The closed settlement as a cash sheet: what came in, what the collector kept, what is left. */
	const sheetRows = $derived<MoneySheetRow[]>([
		{
			label: `Efectivo recibido (${pagos(confirmedCount('cash'))})`,
			value: data.totals.totalCash
		},
		{
			label: `Transferencias (${pagos(confirmedCount('transfer'))})`,
			value: data.totals.totalTransfer
		},
		{ label: 'Total cobrado', value: data.totals.totalAmount, kind: 'subtotal' },
		{
			label: 'Comisión que el cobrador se quedó del efectivo',
			value: data.totals.commissionPaidAmount,
			kind: 'deduction'
		},
		{ label: 'Neto para Bomberos', value: data.totals.netToFirefighters, kind: 'lead' }
	]);
	const sheetSecondary = $derived([
		{ label: 'Comisión generada', value: data.totals.commissionAmount },
		...(cents(data.totals.collectorCreditBalance) !== 0
			? [{ label: 'Saldo a favor del cobrador', value: data.totals.collectorCreditBalance }]
			: [])
	]);
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
		{ key: 'document', header: 'Comprobante' },
		...(data.can.correctPayment ? [{ key: 'actions', header: 'Acciones' }] : [])
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
	title={open
		? `Rendición ${data.settlement.settlementNumber} de ${data.settlement.collectorName}`
		: `Rendición #${data.settlement.settlementNumber}`}
	description={open ? `Desde el ${formatDate(data.settlement.openedAt)}` : meta}
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
	{/snippet}
</PageHeader>

{#if open}
	<OpenSettlement
		campaignId={data.campaign.id}
		settlement={data.settlement}
		totals={data.totals as OpenSettlementTotals}
		payments={data.payments}
		candidates={data.candidates}
		submitted={data.submitted}
		today={data.today}
		reasonMax={data.reasonMax}
		can={data.can}
		form={form as OpenSettlementForm | null}
	/>
{:else}
	<div class="space-y-6">
		{#if form?.message}
			<Alert tone={form.success ? 'success' : 'danger'}>{form.message}</Alert>
		{/if}

		{#if sheet}
			<!-- Redesign: a closed settlement reads like a cash sheet, top to bottom. -->
			<section
				aria-labelledby="sheet-title"
				class="max-w-[560px] rounded-lg border border-border bg-surface px-6 pt-2 pb-5"
			>
				<h2 id="sheet-title" class="sr-only">Totales de la rendición</h2>
				<MoneySheet context="document" rows={sheetRows} secondary={sheetSecondary} />
				{#if data.settlement.status === 'corrected'}
					<p class="m-0 mt-3 text-body-sm text-warning-text">
						Esta rendición tiene una corrección registrada. Los totales de arriba son los del
						cierre; la corrección y sus movimientos están en la cuenta corriente del cobrador.
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
								La rendición cerrada no se edita: se registra una corrección con motivo, que queda
								en la cuenta corriente.
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
			<Card title="Documentos de la rendición">
				<Button
					href={resolve(`/campaigns/${data.campaign.id}/settlements/${data.settlement.id}/print`)}
					>Imprimir remito de rendición</Button
				>
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
							href={resolve(`/campaigns/${data.campaign.id}/payments/${row.id}/print`)}
							>Comprobante</a
						>
					{:else}—{/if}
				{:else if column.key === 'actions'}
					<div class="space-y-2">
						{#if data.can.correctPayment}
							<Disclosure summary="Corregir / anular">
								<div class="space-y-4">
									<Alert tone="info">
										<strong>Vista indicativa:</strong> la base de datos es la que decide. La anulación
										revierte la comisión generada y, en efectivo, acredita la comisión retenida. La corrección
										de método registra solo la diferencia de la retención en efectivo.
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
	</div>
{/if}

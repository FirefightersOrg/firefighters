<script lang="ts">
	import { institutionName } from '$lib/institution';
	import { resolve } from '$app/paths';
	import {
		Alert,
		Badge,
		Card,
		EmptyState,
		PageHeader,
		Stat,
		StatusBadge,
		Table
	} from '$lib/components/ui';
	import type { TableColumn } from '$lib/components/ui';
	import InstallmentsTable from '$lib/components/portal/InstallmentsTable.svelte';
	import RegisterPaymentForm from '$lib/components/portal/RegisterPaymentForm.svelte';
	import { PAYMENT_MODE_LABELS } from '$lib/domain/sales';
	import { bondLabel, submissionStatusLabel, submissionStatusTone } from '$lib/portal/labels';
	import { parseMoneyInput, centsToDecimalString } from '$lib/domain/money';
	import { formatDate, formatMoney } from '$lib/format';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

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
	// What can still be sent per installment: balance minus the drafts already waiting for a settlement.
	const availableFor = (installment: (typeof data.installments)[number]) =>
		centsToDecimalString(
			Math.max(
				0,
				(parseMoneyInput(installment.balance) ?? 0) -
					(parseMoneyInput(data.reserved[installment.id] ?? '0') ?? 0)
			)
		);
	const submissionRows = $derived(data.submissions.map((s) => ({ ...s })));
	const submissionColumns: TableColumn<(typeof submissionRows)[number]>[] = [
		{ key: 'paymentDate', header: 'Fecha' },
		{ key: 'installmentNumbers', header: 'Cuotas' },
		{ key: 'amount', header: 'Monto', align: 'right' },
		{ key: 'method', header: 'Medio' },
		{ key: 'status', header: 'Estado' }
	];
</script>

<svelte:head><title>Venta {bond} - {institutionName()}</title></svelte:head>

<PageHeader
	title={`Venta del bono ${bond}`}
	description={`${sale.campaignName} · ${PAYMENT_MODE_LABELS[sale.paymentMode]} · ${formatDate(sale.soldAt)}`}
	breadcrumbs={[
		{ label: 'Mi portal', href: resolve('/portal') },
		{
			label: 'Mis ventas',
			href: resolve('/portal/[campaignId]/ventas', { campaignId: data.campaign.id })
		},
		{ label: `Bono ${bond}` }
	]}
/>

{#snippet registerAction(installment: (typeof data.installments)[number])}
	{#if ['pending', 'overdue'].includes(installment.status) && Number(availableFor(installment)) > 0}
		<RegisterPaymentForm
			installmentId={installment.id}
			installmentNumber={installment.number}
			available={availableFor(installment)}
			today={data.today}
			noteMax={data.noteMax}
			requestKey={data.requestKey}
			result={form?.form === 'registrar' && form.installmentId === installment.id ? form : null}
		/>
	{:else}
		—
	{/if}
{/snippet}

<div class="space-y-6">
	{#if data.submitted && !form?.message}
		<Alert tone="success" title="Cobro enviado">
			Quedó enviado. Se confirma cuando el operador lo incluye en una rendición y la cierra.
		</Alert>
	{/if}
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
						href={resolve('/portal/[campaignId]/compradores/[buyerId]', {
							campaignId: data.campaign.id,
							buyerId: sale.buyerId
						})}>{sale.buyerName}</a
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
		<InstallmentsTable
			installments={data.installments}
			actions={data.canRegister ? registerAction : undefined}
		/>
	</Card>

	{#if data.submissions.length}
		<Card title="Cobros enviados" flush>
			<Table
				columns={submissionColumns}
				rows={submissionRows}
				rowKey="id"
				caption="Cobros registrados desde el portal"
			>
				{#snippet cell({ row, column })}
					{#if column.key === 'paymentDate'}
						{formatDate(row.paymentDate)}
					{:else if column.key === 'installmentNumbers'}
						{row.installmentNumbers.join(', ') || '—'}
					{:else if column.key === 'amount'}
						<span class="tabular-nums">{formatMoney(row.amount, { decimals: 'always' })}</span>
					{:else if column.key === 'method'}
						{methodLabel[row.method]}
					{:else if column.key === 'status'}
						<Badge tone={submissionStatusTone(row.status)}
							>{submissionStatusLabel(row.status)}</Badge
						>
						{#if row.status === 'annulled' && row.rejectionReason}
							<p class="m-0 mt-1 text-body-sm text-muted">Motivo: {row.rejectionReason}</p>
						{/if}
						{#if row.note}
							<p class="m-0 mt-1 text-body-sm text-muted">Nota: {row.note}</p>
						{/if}
					{/if}
				{/snippet}
			</Table>
		</Card>
	{/if}

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
					<Badge tone={submissionStatusTone(row.status)}>{submissionStatusLabel(row.status)}</Badge>
				{/if}
			{/snippet}
			{#snippet empty()}
				<EmptyState title="Todavía no hay pagos" />
			{/snippet}
		</Table>
	</Card>
</div>

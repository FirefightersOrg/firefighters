<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		Alert,
		Button,
		Card,
		Field,
		PageHeader,
		Select,
		StatusBadge,
		Table,
		Textarea
	} from '$lib/components/ui';
	import type { TableColumn } from '$lib/components/ui';
	import { PAYMENT_MODE_LABELS } from '$lib/domain/sales';
	import type { BondFinancialStatus } from '$lib/domain/bonds';
	import { formatDate, formatDateTime, formatMoney } from '$lib/format';
	import { campaignNumberingConfig } from '$lib/domain/campaigns';
	import { formatCampaignNumber } from '$lib/domain/numbering';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	const numbering = $derived(campaignNumberingConfig(data.campaign));
	const bondLabel = $derived(
		data.sale.bondNumberPairs
			.map(
				({ base, associated }) =>
					`${formatCampaignNumber(base, numbering)}${
						associated === null ? '' : ` / ${formatCampaignNumber(associated, numbering)}`
					}`
			)
			.join(', ')
	);
	const installments = $derived(
		data.sale.installments.map((i) => ({
			id: i.id,
			installmentNumber: i.installmentNumber,
			dueDate: i.dueDate,
			amount: i.amount,
			status: i.status
		}))
	);
	type Installment = (typeof installments)[number];
	const columns: TableColumn<Installment>[] = [
		{ key: 'installmentNumber', header: 'N.º', align: 'right' },
		{ key: 'dueDate', header: 'Vencimiento' },
		{ key: 'amount', header: 'Importe', align: 'right' },
		{ key: 'status', header: 'Estado' }
	];
	const buyerOptions = $derived([
		{ value: '', label: 'Elegir…' },
		...(data.correction?.buyers ?? []).map((buyer) => ({
			value: buyer.id,
			label: buyer.businessName ?? [buyer.firstName, buyer.lastName].filter(Boolean).join(' ')
		}))
	]);
	const collectorOptions = $derived([
		{ value: '', label: 'Elegir…' },
		...(data.correction?.collectors ?? []).map((c) => ({ value: c.id, label: c.displayName }))
	]);
	/** The markUncollectible action's result, typed loosely like the other form results. */
	const markForm = $derived(
		form?.form === 'markUncollectible'
			? (form as {
					success?: boolean;
					values?: { reason?: string };
					errors?: Record<string, string[] | undefined>;
				})
			: null
	);
	const link = 'rounded-sm text-primary-text underline-offset-2 hover:underline';
</script>

<svelte:head><title>Venta - {data.campaign.name}</title></svelte:head>

<PageHeader
	title="Venta del bono {bondLabel}"
	description="{PAYMENT_MODE_LABELS[data.sale.sale.paymentMode]} · {formatMoney(
		data.sale.sale.totalAmount,
		{ decimals: 'always' }
	)}"
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: data.campaign.name, href: resolve('/campaigns/[id]', { id: data.campaign.id }) },
		{ label: 'Ventas', href: resolve('/campaigns/[id]/sales', { id: data.campaign.id }) },
		{ label: bondLabel }
	]}
/>

<div class="space-y-6">
	{#if form?.message}
		<Alert tone={form.success ? 'success' : 'danger'}>{form.message}</Alert>
	{/if}
	<Card title="Datos de la venta">
		<dl class="grid gap-3 text-body sm:grid-cols-3">
			<div>
				<dt class="text-muted">Bono</dt>
				<dd>
					<a
						class={link}
						href={resolve('/campaigns/[id]/bonds/[bondId]', {
							id: data.campaign.id,
							bondId: data.sale.bondId
						})}>{bondLabel}</a
					>
				</dd>
			</div>
			<div>
				<dt class="text-muted">Comprador</dt>
				<dd>
					<a
						class={link}
						href={resolve('/campaigns/[id]/buyers/[buyerId]', {
							id: data.campaign.id,
							buyerId: data.sale.sale.buyerId
						})}>{data.sale.buyerName}</a
					>
				</dd>
			</div>
			<div>
				<dt class="text-muted">Cobrador</dt>
				<dd>
					<a
						class={link}
						href={resolve('/campaigns/[id]/collectors/[collectorId]', {
							id: data.campaign.id,
							collectorId: data.sale.sale.collectorId
						})}>{data.sale.collectorName}</a
					>
				</dd>
			</div>
			<div>
				<dt class="text-muted">Modalidad</dt>
				<dd>{PAYMENT_MODE_LABELS[data.sale.sale.paymentMode]}</dd>
			</div>
			<div>
				<dt class="text-muted">Total</dt>
				<dd class="tabular-nums">
					{formatMoney(data.sale.sale.totalAmount, { decimals: 'always' })}
				</dd>
			</div>
			<div>
				<dt class="text-muted">Estado financiero</dt>
				<dd>
					<StatusBadge
						kind="bondFinancial"
						status={data.financialStatusSnapshot as BondFinancialStatus}
					/>
				</dd>
			</div>
		</dl>
	</Card>

	{#if data.sale.uncollectible}
		<Alert tone="warning" title="Venta incobrable">
			Marcada el {formatDateTime(data.sale.uncollectible.markedAt)}. Motivo: {data.sale
				.uncollectible.reason}
		</Alert>
	{:else if data.canMarkUncollectible}
		<Card title="Marcar como incobrable">
			<p class="text-body text-muted">
				Pasa la venta a estado financiero «Incobrable» aunque después se registren pagos. Queda
				auditado y no se puede deshacer.
			</p>
			<form method="POST" action="?/markUncollectible" class="mt-4 space-y-3">
				<Field
					label="Motivo"
					id="uncollectible-reason"
					required
					hint="Hasta 1000 caracteres."
					error={markForm && !markForm.success ? markForm.errors?.reason?.[0] : undefined}
				>
					<Textarea name="reason" value={markForm?.values?.reason ?? ''} />
				</Field>
				<Button type="submit" variant="danger">Marcar como incobrable</Button>
			</form>
		</Card>
	{/if}

	{#if data.correction}
		<Card title="Correcciones auditadas">
			<Alert tone="info">
				<strong>Vista indicativa:</strong> cambiar el comprador no mueve la cuenta corriente. Cambiar
				el cobrador compensa la comisión histórica entre cobradores según la prioridad de reglas vigente;
				los cálculos guardados en la base de datos son los que valen.
			</Alert>
			<div class="mt-4 grid gap-6 sm:grid-cols-2">
				<form method="POST" action="?/correctBuyer" class="space-y-3">
					<Field label="Comprador correcto" id="newBuyerId" required>
						<Select name="newBuyerId" options={buyerOptions} value="" />
					</Field>
					{#if (data.correction.buyersTotal ?? 0) > data.correction.buyers.length}
						<p class="text-body-sm text-muted" data-testid="buyers-truncated">
							Se muestran los primeros {data.correction.buyers.length} de {data.correction
								.buyersTotal}
							compradores. Si falta el correcto, abrir su ficha desde el listado de compradores.
						</p>
					{/if}
					<Field label="Motivo" id="buyer-reason" required hint="Hasta 1000 caracteres.">
						<Textarea name="reason" />
					</Field>
					<Button type="submit">Confirmar corrección del comprador</Button>
				</form>
				<form method="POST" action="?/correctCollector" class="space-y-3">
					<Field label="Cobrador correcto" id="newCollectorId" required>
						<Select name="newCollectorId" options={collectorOptions} value="" />
					</Field>
					<Field label="Motivo" id="collector-reason" required hint="Hasta 1000 caracteres.">
						<Textarea name="reason" />
					</Field>
					<Button type="submit">Confirmar corrección del cobrador</Button>
				</form>
			</div>
		</Card>
	{/if}

	<Table {columns} rows={installments} caption="Plan de cuotas">
		{#snippet cell({ row, column })}
			{#if column.key === 'installmentNumber'}
				<span class="tabular-nums">{row.installmentNumber}</span>
			{:else if column.key === 'dueDate'}
				{formatDate(row.dueDate)}
			{:else if column.key === 'amount'}
				<span class="tabular-nums">{formatMoney(row.amount, { decimals: 'always' })}</span>
			{:else}
				<StatusBadge kind="installment" status={row.status} />
			{/if}
		{/snippet}
	</Table>
</div>

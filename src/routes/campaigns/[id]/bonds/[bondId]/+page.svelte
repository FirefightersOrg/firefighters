<script lang="ts">
	import { institutionName } from '$lib/institution';
	import { resolve } from '$app/paths';
	import BondActionsSection from '$lib/components/bonds/record/BondActionsSection.svelte';
	import BondAuditSection from '$lib/components/bonds/record/BondAuditSection.svelte';
	import BondBarcodeSection from '$lib/components/bonds/record/BondBarcodeSection.svelte';
	import BondCustodySection from '$lib/components/bonds/record/BondCustodySection.svelte';
	import BondGeneralSection from '$lib/components/bonds/record/BondGeneralSection.svelte';
	import BondNumbersSection from '$lib/components/bonds/record/BondNumbersSection.svelte';
	import BondPartySection from '$lib/components/bonds/record/BondPartySection.svelte';
	import BondPendingSection from '$lib/components/bonds/record/BondPendingSection.svelte';
	import RecordSection from '$lib/components/bonds/record/RecordSection.svelte';
	import { BOND_RECORD_SECTIONS } from '$lib/components/bonds/record/types';
	import {
		Alert,
		Button,
		Disclosure,
		Field,
		PageHeader,
		Select,
		StatusBadge,
		Table,
		Textarea,
		type TableColumn
	} from '$lib/components/ui';
	import { DRAW_INELIGIBILITY_REASON_LABELS } from '$lib/domain/draw-eligibility';
	import { buenosAiresDateTimeLocal } from '$lib/domain/draws-datetime';
	import type { PaymentMode } from '$lib/domain/sales';
	import { wonPrizeCount as wonCount } from '$lib/domain/prizes';
	import { formatDate, formatMoney } from '$lib/format';
	import type { PageProps } from './$types';

	/**
	 * Bond record: the 14 sections of docs/screens.md "Bond record", one component each, with an
	 * index of anchors at the top. The actions (ungroup / annul) follow the general data.
	 */
	let { data, form }: PageProps = $props();

	const campaign = $derived(data.campaign);
	const record = $derived(data.record);
	const general = $derived(record.general);
	const title = $derived(
		record.numbers.length > 0
			? `${general.typeLabel} ${record.numbers
					.filter((n) => n.kind === 'base')
					.map((n) => n.formatted)
					.join(' + ')}`
			: general.typeLabel
	);
	const errors = $derived({
		ungroup:
			form?.form === 'ungroup' && !form.success
				? (form.errors as Record<string, string[]>).reason
				: undefined,
		annul:
			form?.form === 'annul' && !form.success
				? (form.errors as Record<string, string[]>).reason
				: undefined
	});
	const formErrors = $derived((form?.errors ?? {}) as Record<string, string[]>);
	const deliveredAt = (value: string | null) =>
		value ? `${buenosAiresDateTimeLocal(value).replace('T', ' ')} (Buenos Aires)` : '—';

	const PAYMENT_MODE_ES: Record<PaymentMode, string> = {
		full_payment: 'Pago total',
		installments: 'En cuotas'
	};
	const METHOD_ES: Record<string, string> = { cash: 'Efectivo', transfer: 'Transferencia' };
	const KIND_ES: Record<string, string> = {
		base: 'Base',
		associated: 'Asociado',
		extraordinary: 'Extraordinario'
	};
	const ineligibility = (reason: string | null) =>
		reason ? ((DRAW_INELIGIBILITY_REASON_LABELS as Record<string, string>)[reason] ?? reason) : '';
	const collectorOptions = $derived([
		{ value: '', label: 'Elegir…' },
		...data.custody.collectors.map((c) => ({ value: c.id, label: c.displayName }))
	]);

	type Row = Record<string, unknown> & { id: string };
	const installmentColumns: TableColumn<Row>[] = [
		{ key: 'number', header: 'N.º', align: 'right' },
		{ key: 'due', header: 'Vencimiento' },
		{ key: 'amount', header: 'Importe', align: 'right' },
		{ key: 'status', header: 'Estado' }
	];
	const paymentColumns: TableColumn<Row>[] = [
		{ key: 'date', header: 'Fecha' },
		{ key: 'amount', header: 'Importe', align: 'right' },
		{ key: 'method', header: 'Medio' },
		{ key: 'status', header: 'Estado' },
		{ key: 'settlement', header: 'Rendición' },
		{ key: 'document', header: 'Comprobante' }
	];
	const rosterColumns: TableColumn<Row>[] = [
		{ key: 'draw', header: 'Sorteo' },
		{ key: 'number', header: 'Número' },
		{ key: 'kind', header: 'Tipo' },
		{ key: 'eligibility', header: 'Habilitación' }
	];
	const prizeColumns: TableColumn<Row>[] = [
		{ key: 'draw', header: 'Sorteo' },
		{ key: 'prize', header: 'Premio' },
		{ key: 'status', header: 'Estado' },
		{ key: 'deliveredAt', header: 'Entregado el' }
	];
	const installmentRows = $derived((data.installments ?? []) as unknown as Row[]);
	const paymentRows = $derived((data.payments ?? []) as unknown as Row[]);
	const rosterRows = $derived((data.drawRosterEntries ?? []) as unknown as Row[]);
	const prizeRows = $derived((data.prizes ?? []) as unknown as Row[]);
</script>

<svelte:head>
	<title>{title} - {campaign.name} - {institutionName()}</title>
</svelte:head>

<PageHeader
	{title}
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: campaign.name, href: resolve('/campaigns/[id]', { id: campaign.id }) },
		{ label: 'Bonos', href: resolve('/campaigns/[id]/bonds', { id: campaign.id }) },
		{ label: title }
	]}
>
	{#snippet actions()}
		<StatusBadge kind="bondCommercial" status={general.commercialStatus} />
	{/snippet}
</PageHeader>

<div class="flex flex-col gap-6">
	<nav aria-label="Secciones de la ficha">
		<ol class="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-body-sm">
			{#each BOND_RECORD_SECTIONS as section, i (section.id)}
				<li>
					<a href="#{section.id}" class="text-primary-text underline-offset-2 hover:underline"
						>{i + 1}. {section.title}</a
					>
				</li>
			{/each}
		</ol>
	</nav>

	{#if form?.success}
		<Alert tone="success">{form.message}</Alert>
	{:else if form?.message && !formErrors.reason?.length}
		<Alert tone="danger">{form.message}</Alert>
	{/if}

	<BondGeneralSection campaignId={campaign.id} {general} group={record.group} />
	<BondActionsSection actions={record.actions} isPata={general.kind === 'pata'} {errors} />
	<BondNumbersSection campaignId={campaign.id} bondId={general.id} numbers={record.numbers} />
	<BondBarcodeSection barcode={record.barcode} />
	<BondPartySection role="collector" party={record.collector} />
	{#if data.custody.can.correctCollector}
		<Disclosure summary="Corregir cobrador">
			<div class="flex flex-col gap-4">
				<Alert tone="warning">
					<strong>Vista previa indicativa:</strong> un bono sin vender solo cambia de custodia. Un bono
					vendido compensa la comisión histórica entre cobradores; las reglas de precedencia de la base
					de datos y los movimientos registrados en el libro mayor son los que rigen.
				</Alert>
				<form method="POST" action="?/correctCollector" class="flex flex-col gap-4">
					<input type="hidden" name="sold" value={data.sale ? 'true' : 'false'} />
					<Field label="Cobrador nuevo" id="correctCollectorId" required>
						<Select name="newCollectorId" options={collectorOptions} value="" />
					</Field>
					<Field
						label="Motivo"
						id="correctCollectorReason"
						required
						hint="Hasta 1000 caracteres Unicode."
					>
						<Textarea name="reason" rows={3} />
					</Field>
					<div><Button type="submit">Confirmar corrección del cobrador</Button></div>
				</form>
			</div>
		</Disclosure>
	{/if}
	<BondCustodySection
		campaignId={campaign.id}
		fromCollectorId={data.custody.fromCollectorId}
		history={data.custody.history}
		collectors={data.custody.collectors}
		can={data.custody.can}
		form={form?.form === 'custody' ? form : null}
	/>
	<BondPartySection role="buyer" party={record.buyer} />

	<RecordSection id="sale">
		{#if data.sale}
			<p class="m-0 text-body-sm">
				Venta activa —
				<a
					class="text-primary-text underline-offset-2 underline"
					href={resolve('/campaigns/[id]/sales/[saleId]', {
						id: campaign.id,
						saleId: data.sale.sale.id
					})}>ver venta</a
				>. {PAYMENT_MODE_ES[data.sale.sale.paymentMode]}, {formatMoney(data.sale.sale.totalAmount)}.
			</p>
		{:else}
			<p class="m-0 text-body-sm text-muted">Este bono no se vendió.</p>
		{/if}
	</RecordSection>

	<RecordSection id="installments">
		{#if installmentRows.length}
			<Table
				columns={installmentColumns}
				rows={installmentRows}
				caption="Cuotas del bono"
				density="compact"
			>
				{#snippet cell({ row, column })}
					{#if column.key === 'number'}
						<span class="tabular-nums">{row.installmentNumber}</span>
					{:else if column.key === 'due'}
						{formatDate(row.dueDate as string)}
					{:else if column.key === 'amount'}
						<span class="tabular-nums">{formatMoney(row.amount as string)}</span>
					{:else if column.key === 'status'}
						<StatusBadge kind="installment" status={row.status as 'pending'} />
					{/if}
				{/snippet}
			</Table>
		{:else}
			<p class="m-0 text-body-sm text-muted">Sin plan de cuotas.</p>
		{/if}
	</RecordSection>

	<RecordSection id="payments">
		{#if paymentRows.length}
			<Table columns={paymentColumns} rows={paymentRows} caption="Pagos del bono" density="compact">
				{#snippet cell({ row, column })}
					{#if column.key === 'date'}
						{formatDate(row.date as string)}
					{:else if column.key === 'amount'}
						<span class="tabular-nums">{formatMoney(row.amount as string)}</span>
					{:else if column.key === 'method'}
						{METHOD_ES[row.method as string] ?? row.method}
					{:else if column.key === 'status'}
						<StatusBadge kind="payment" status={row.status as 'confirmed'} />
					{:else if column.key === 'settlement'}
						{#if row.settlementId}
							<a
								class="text-primary-text underline-offset-2 hover:underline"
								href={resolve('/campaigns/[id]/settlements/[settlementId]', {
									id: campaign.id,
									settlementId: row.settlementId as string
								})}>N.º {row.settlementNumber}</a
							>
						{:else}—{/if}
					{:else if column.key === 'document'}
						{#if row.status === 'confirmed'}
							<a
								class="text-primary-text underline-offset-2 hover:underline"
								href={resolve(`/campaigns/${campaign.id}/payments/${row.id}/print`)}>Comprobante</a
							>
						{:else}—{/if}
					{/if}
				{/snippet}
			</Table>
		{:else}
			<p class="m-0 text-body-sm text-muted">No hay pagos registrados.</p>
		{/if}
	</RecordSection>

	<BondPendingSection id="settlements" />
	<BondPendingSection id="commissions" />

	<RecordSection id="draws">
		{#if data.canViewDraws === false}
			<p class="m-0 text-body-sm text-muted">No hay permiso para ver los padrones de sorteos.</p>
		{:else if rosterRows.length}
			<Table
				columns={rosterColumns}
				rows={rosterRows}
				caption="Padrones de sorteos"
				density="compact"
			>
				{#snippet cell({ row, column })}
					{@const draw = row.draw as { id: string; name: string }}
					{#if column.key === 'draw'}
						<a
							class="text-primary-text underline-offset-2 hover:underline"
							href={resolve('/campaigns/[id]/draws/[drawId]/roster', {
								id: campaign.id,
								drawId: draw.id
							})}>{draw.name}</a
						>
					{:else if column.key === 'number'}
						<span class="font-mono tabular-nums"
							>{String(row.numberValue).padStart(campaign.numberDigits, '0')}</span
						>
					{:else if column.key === 'kind'}
						{KIND_ES[row.numberKind as string] ?? row.numberKind}
					{:else if column.key === 'eligibility'}
						{row.eligible
							? 'Habilitado'
							: `No habilitado — ${ineligibility(row.ineligibilityReason as string | null)}`}
					{/if}
				{/snippet}
			</Table>
		{:else}
			<p class="m-0 text-body-sm text-muted">No figura en ningún padrón de sorteo.</p>
		{/if}
	</RecordSection>

	<RecordSection id="prizes">
		<p class="m-0 mb-2 text-body-sm text-muted">Premios ganados: {wonCount(data.prizes)}</p>
		{#if data.canViewPrizes === false}
			<p class="m-0 text-body-sm text-muted">No hay permiso para ver los premios.</p>
		{:else if prizeRows.length}
			<Table columns={prizeColumns} rows={prizeRows} caption="Premios del bono" density="compact">
				{#snippet cell({ row, column })}
					{#if column.key === 'draw'}
						<a
							class="text-primary-text underline-offset-2 hover:underline"
							href={resolve('/campaigns/[id]/draws/[drawId]/winners', {
								id: campaign.id,
								drawId: row.drawId as string
							})}>{row.drawName}</a
						>
					{:else if column.key === 'prize'}
						N.º {row.position} — {row.name}
					{:else if column.key === 'status'}
						<StatusBadge kind="prize" status={row.status as 'awarded'} />
						{#if row.status === 'annulled'}
							<span class="ml-1 text-caption text-muted">No cuenta como ganado</span>
						{/if}
					{:else if column.key === 'deliveredAt'}
						{deliveredAt(row.deliveredAt as string | null)}
					{/if}
				{/snippet}
			</Table>
		{:else}
			<p class="m-0 text-body-sm text-muted">Sin premios.</p>
		{/if}
	</RecordSection>

	<BondAuditSection campaignId={campaign.id} audit={record.audit} />
</div>

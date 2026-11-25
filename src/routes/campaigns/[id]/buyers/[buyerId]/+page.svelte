<script lang="ts">
	import { resolve } from '$app/paths';
	import BuyerForm from '$lib/components/buyers/BuyerForm.svelte';
	import { EmptyState, PageHeader, Section, Stat, StatusBadge, Table } from '$lib/components/ui';
	import type { TableColumn } from '$lib/components/ui';
	import { buyerDisplayName, buyerIdentification, BUYER_TYPE_LABELS } from '$lib/domain/parties';
	import { formatCampaignNumber } from '$lib/domain/numbering';
	import { centsToDecimalString, parseMoneyToCents } from '$lib/domain/money';
	import { wonPrizeCount as wonCount } from '$lib/domain/prizes';
	import { formatDate, formatDateTime, formatMoney, formatNumber } from '$lib/format';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const baseNumbers = (bond: { baseNumbers: number[]; campaignNumberDigits: number }) =>
		bond.baseNumbers
			.map((number) =>
				formatCampaignNumber(number, {
					numberDigits: bond.campaignNumberDigits,
					maxNumber: 10 ** bond.campaignNumberDigits - 1,
					associatedNumberOffset: 0,
					associatedNumberMode: 'linear',
					overflowPolicy: 'reject'
				})
			)
			.join(', ');
	// Exact cents (no floating point), over the installments listed on the record.
	const pendingCents = $derived(
		(data.installments ?? []).reduce(
			(total, item) => total + (parseMoneyToCents(item.amount) ?? 0),
			0
		)
	);
	const deliveredAt = (value: string | null) =>
		value ? `${formatDateTime(value)} (hora de Buenos Aires)` : '—';
	const listHref = $derived(resolve('/campaigns/[id]/buyers', { id: data.campaign.id }));
	const dash = (value: string | null) => value ?? '—';

	const installmentRows = $derived(
		(data.installments ?? []).map((installment) => ({
			id: installment.id,
			saleId: installment.saleId,
			dueDate: formatDate(installment.dueDate),
			amount: formatMoney(installment.amount, { decimals: 'always' }),
			status: installment.status
		}))
	);
	type InstallmentRow = (typeof installmentRows)[number];
	const installmentColumns: TableColumn<InstallmentRow>[] = [
		{ key: 'sale', header: 'Venta' },
		{ key: 'dueDate', header: 'Vencimiento' },
		{ key: 'amount', header: 'Monto', align: 'right' },
		{ key: 'status', header: 'Estado' }
	];

	const prizeRows = $derived(
		(data.prizes ?? []).map((prize) => ({
			id: prize.id,
			drawId: prize.drawId,
			drawName: prize.drawName,
			prize: `#${prize.position} — ${prize.name}`,
			status: prize.status,
			deliveredAt: deliveredAt(prize.deliveredAt)
		}))
	);
	type PrizeRow = (typeof prizeRows)[number];
	const prizeColumns: TableColumn<PrizeRow>[] = [
		{ key: 'draw', header: 'Sorteo' },
		{ key: 'prize', header: 'Premio' },
		{ key: 'status', header: 'Estado' },
		{ key: 'deliveredAt', header: 'Entregado el' }
	];
</script>

<svelte:head
	><title>{buyerDisplayName(data.buyer)} - {data.campaign.name} - Firefighters</title></svelte:head
>

<PageHeader
	title={buyerDisplayName(data.buyer)}
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: data.campaign.name, href: resolve('/campaigns/[id]', { id: data.campaign.id }) },
		{ label: 'Compradores', href: listHref },
		{ label: buyerDisplayName(data.buyer) }
	]}
/>

<div class="flex flex-col gap-6">
	<Section id="general" title="Datos generales">
		{#if data.canManage}
			<BuyerForm
				campaignId={data.campaign.id}
				buyer={data.buyer}
				collectors={data.collectors}
				usualCollectorNotVisible={data.usualCollectorNotVisible}
				canViewCollectors={data.canViewCollectors}
				{form}
			/>
		{:else}
			<dl class="m-0 grid gap-4 sm:grid-cols-2">
				<div>
					<dt class="text-label text-muted">Tipo</dt>
					<dd class="m-0">{BUYER_TYPE_LABELS[data.buyer.type]}</dd>
				</div>
				<div>
					<dt class="text-label text-muted">Nombre</dt>
					<dd class="m-0">{buyerDisplayName(data.buyer)}</dd>
				</div>
				<div>
					<dt class="text-label text-muted">Identificación</dt>
					<dd class="m-0">{buyerIdentification(data.buyer) ?? '—'}</dd>
				</div>
				<div>
					<dt class="text-label text-muted">Teléfono</dt>
					<dd class="m-0">{dash(data.buyer.phone)}</dd>
				</div>
				<div>
					<dt class="text-label text-muted">Cobrador habitual</dt>
					<dd class="m-0">{data.collector?.displayName ?? '—'}</dd>
				</div>
				<div>
					<dt class="text-label text-muted">Domicilio</dt>
					<dd class="m-0">{dash(data.buyer.address)}</dd>
				</div>
				<div class="sm:col-span-2">
					<dt class="text-label text-muted">Notas</dt>
					<dd class="m-0 whitespace-pre-wrap">{dash(data.buyer.notes)}</dd>
				</div>
			</dl>
		{/if}
	</Section>

	<Section id="bonds" title="Bonos comprados en esta campaña">
		<ul class="m-0 flex list-none flex-col gap-2 p-0">
			{#each data.sales as sale (sale.sale.id)}
				<li>
					<a
						class="rounded-sm text-primary-text underline-offset-2 hover:underline"
						href={resolve('/campaigns/[id]/sales/[saleId]', {
							id: data.campaign.id,
							saleId: sale.sale.id
						})}>Venta</a
					>
					—
					<a
						class="rounded-sm font-mono text-primary-text underline-offset-2 hover:underline"
						href={resolve('/campaigns/[id]/bonds/[bondId]', {
							id: data.campaign.id,
							bondId: sale.bondId
						})}>{sale.bondNumbers.join(', ') || 'Sin número base'}</a
					>
				</li>
			{:else}
				{#each data.campaignBonds as bond (bond.id)}
					<li>
						<a
							class="rounded-sm font-mono text-primary-text underline-offset-2 hover:underline"
							href={resolve('/campaigns/[id]/bonds/[bondId]', {
								id: data.campaign.id,
								bondId: bond.id
							})}>{baseNumbers(bond) || 'Sin número base'}</a
						>
					</li>
				{:else}
					<li class="text-muted">No compró bonos en esta campaña.</li>
				{/each}
			{/each}
		</ul>
	</Section>

	<Section id="installments" title="Cuotas y deuda">
		<div class="mb-4 max-w-sm">
			<Stat
				label="Total pendiente"
				value={formatMoney(centsToDecimalString(pendingCents), { decimals: 'always' })}
				detail={(data.installmentsTotal ?? 0) > (data.installments ?? []).length
					? `Primeras ${formatNumber((data.installments ?? []).length)} de ${formatNumber(data.installmentsTotal ?? 0)} cuotas pendientes`
					: undefined}
			/>
		</div>
		<Table columns={installmentColumns} rows={installmentRows} caption="Cuotas pendientes">
			{#snippet cell({ row, column })}
				{#if column.key === 'sale'}
					<a
						class="rounded-sm text-primary-text underline-offset-2 hover:underline"
						href={resolve('/campaigns/[id]/sales/[saleId]', {
							id: data.campaign.id,
							saleId: row.saleId
						})}>Venta</a
					>
				{:else if column.key === 'status'}
					<StatusBadge kind="installment" status={row.status} />
				{:else}
					{row[column.key as keyof InstallmentRow]}
				{/if}
			{/snippet}
			{#snippet empty()}
				<EmptyState title="No hay cuotas pendientes" />
			{/snippet}
		</Table>
	</Section>

	<Section id="prizes" title="Premios ganados ({formatNumber(wonCount(data.prizes))})">
		{#if data.canViewPrizes === false}
			<p class="m-0 text-muted">No hay permiso para ver los premios.</p>
		{:else}
			<Table columns={prizeColumns} rows={prizeRows} caption="Premios ganados">
				{#snippet cell({ row, column })}
					{#if column.key === 'draw'}
						<a
							class="rounded-sm text-primary-text underline-offset-2 hover:underline"
							href={resolve('/campaigns/[id]/draws/[drawId]/winners', {
								id: data.campaign.id,
								drawId: row.drawId
							})}>{row.drawName}</a
						>
					{:else if column.key === 'status'}
						<StatusBadge kind="prize" status={row.status} />
						{#if row.status === 'annulled'}
							<span class="ml-1 text-body-sm text-muted">No cuenta como ganado</span>
						{/if}
					{:else}
						{row[column.key as keyof PrizeRow]}
					{/if}
				{/snippet}
				{#snippet empty()}
					<EmptyState title="No ganó premios" />
				{/snippet}
			</Table>
		{/if}
	</Section>

	<Section id="history" title="Números históricos">
		<ul class="m-0 flex list-none flex-col gap-2 p-0">
			{#each data.historicalBonds as bond (bond.id)}
				<li>
					{bond.campaignName}:
					<a
						class="rounded-sm font-mono text-primary-text underline-offset-2 hover:underline"
						href={resolve('/campaigns/[id]/bonds/[bondId]', {
							id: bond.campaignId,
							bondId: bond.id
						})}>{baseNumbers(bond) || 'Sin número base'}</a
					>
				</li>
			{:else}
				<li class="text-muted">No hay números históricos.</li>
			{/each}
		</ul>
	</Section>

	<Section id="audit" title="Auditoría">
		{#if data.audit}
			<ul class="m-0 flex list-none flex-col divide-y divide-border p-0">
				{#each data.audit.entries as entry (entry.id)}
					<li class="py-3">
						<strong>{entry.action}</strong>
						<span class="text-muted"
							>· {entry.actorName ?? 'Usuario desconocido'} · {formatDateTime(
								entry.createdAt
							)}</span
						>
					</li>
				{:else}
					<li class="text-muted">No hay movimientos de auditoría.</li>
				{/each}
			</ul>
		{:else}
			<p class="m-0 text-muted">No hay permiso para ver el historial de auditoría.</p>
		{/if}
	</Section>
</div>

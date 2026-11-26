<script lang="ts">
	import { resolve } from '$app/paths';
	import BuyerForm from '$lib/components/buyers/BuyerForm.svelte';
	import {
		Badge,
		BondNumber,
		Button,
		Disclosure,
		Money,
		PageHeader,
		StatusBadge
	} from '$lib/components/ui';
	import { buyerSummary } from '$lib/domain/buyer-summary';
	import { campaignNumberingConfig } from '$lib/domain/campaigns';
	import { centsToDecimalString } from '$lib/domain/money';
	import { formatCampaignNumber } from '$lib/domain/numbering';
	import { buyerDisplayName, buyerIdentification } from '$lib/domain/parties';
	import { wonPrizeCount as wonCount } from '$lib/domain/prizes';
	import { formatDate, formatDateTime, formatPaddedNumber } from '$lib/format';
	import { institutionName } from '$lib/institution';
	import type { PageProps } from './$types';

	/**
	 * Buyer record (UX plan PR 15, audit A12). The first screen says which bonds the buyer bought in
	 * the campaign and what is owed, with the way to call them; then each bond with its debt in the
	 * words of the sale record, and the unpaid installments by due date; the prizes; and the data,
	 * the bonds of other campaigns and the history collapsed underneath. The `update` action and its
	 * form are the same.
	 */
	let { data, form }: PageProps = $props();

	/** How many rows of a list the record shows before the rest is collapsed. */
	const SHOWN = 10;

	const campaign = $derived(data.campaign);
	const buyer = $derived(data.buyer);
	const numbering = $derived(campaignNumberingConfig(campaign));
	const padded = (number: number | string) =>
		typeof number === 'number' ? formatCampaignNumber(number, numbering) : number;
	/** «Ada Lovelace»: the name as it is said, for sentences (the heading keeps «Lovelace, Ada»). */
	const spokenName = $derived(
		buyer.type === 'business'
			? (buyer.businessName ?? buyerDisplayName(buyer))
			: [buyer.firstName, buyer.lastName].filter(Boolean).join(' ') || buyerDisplayName(buyer)
	);

	type SaleItem = (typeof data.sales)[number];
	const bases = (item: SaleItem) =>
		(item.bondNumberPairs?.map((pair) => pair.base) ?? item.bondNumbers ?? [])
			.map(padded)
			.join(' + ');
	const associated = (item: SaleItem) =>
		(item.bondNumberPairs ?? [])
			.filter((pair) => pair.associated !== null)
			.map((pair) => padded(pair.associated as number))
			.join(' + ');
	const saleById = $derived(new Map((data.sales ?? []).map((item) => [item.sale.id, item])));

	const summary = $derived(
		buyerSummary({
			name: spokenName,
			sales: (data.sales ?? []).map((item) => ({
				saleId: item.sale.id,
				status: item.sale.status,
				bond: bases(item),
				collectorId: item.sale.collectorId,
				collectorName: data.saleCollectors?.[item.sale.id] ?? null,
				soldAt: item.sale.soldAt,
				totalAmount: item.sale.totalAmount,
				installments: data.saleInstallments?.[item.sale.id] ?? null,
				uncollectible: item.financialStatus === 'uncollectible'
			})),
			today: data.today
		})
	);
	const collectorHref = (id: string) =>
		data.canViewCollectors
			? resolve('/campaigns/[id]/collectors/[collectorId]', { id: campaign.id, collectorId: id })
			: null;
	/** The collector the sentence names: the one of every active sale. */
	const summaryCollectorId = $derived(summary.sales.find((sale) => sale.active)?.collectorId);
	/** Rows name their collector only when the buyer's bonds are collected by more than one. */
	const manyCollectors = $derived(
		new Set(summary.sales.filter((sale) => sale.active).map((sale) => sale.collectorId)).size > 1
	);

	/** The figure the record leads with, and what it is. */
	const lead = $derived.by(() => {
		if (summary.debtCents > 0)
			return { label: 'Falta cobrar', value: centsToDecimalString(summary.debtCents) };
		if (summary.bondCount > 0 && summary.complete && summary.uncollectibleCents === 0)
			return { label: 'Pagado', value: summary.totalAmount };
		return null;
	});
	const payHref = $derived(
		data.canPay && summary.payCollectorId
			? `${resolve('/campaigns/[id]/settlements/new', { id: campaign.id })}?intent=payment&collector=${summary.payCollectorId}`
			: null
	);
	const phone = $derived(buyer.phone?.trim() || null);

	const salesShown = $derived(summary.sales.slice(0, SHOWN));
	const salesRest = $derived(summary.sales.slice(SHOWN));
	const pendingShown = $derived(summary.pending.slice(0, SHOWN));
	const pendingRest = $derived(summary.pending.slice(SHOWN));

	/** Bonds whose buyer is this one but whose sale the record did not list (legacy data). */
	const looseBonds = $derived((data.sales ?? []).length === 0 ? (data.campaignBonds ?? []) : []);
	const bondNumbers = (bond: { baseNumbers: number[]; campaignNumberDigits: number }) =>
		bond.baseNumbers
			.map((number) => formatPaddedNumber(number, bond.campaignNumberDigits))
			.join(' + ');

	const prizes = $derived(data.prizes ?? []);
	const historicalBonds = $derived(data.historicalBonds ?? []);
	const usualCollector = $derived(data.collector ?? null);
	const identification = $derived(buyerIdentification(buyer));
	const hasFacts = $derived(
		!!identification || !!buyer.address || !!usualCollector || !!buyer.notes
	);
	const rowLink =
		'flex min-h-14 items-center gap-3 rounded-sm py-2 text-text no-underline hover:bg-surface-hover';
</script>

<svelte:head>
	<title>{buyerDisplayName(buyer)} - {campaign.name} - {institutionName()}</title>
</svelte:head>

<PageHeader
	title={buyerDisplayName(buyer)}
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: campaign.name, href: resolve('/campaigns/[id]', { id: campaign.id }) },
		{ label: 'Compradores', href: resolve('/campaigns/[id]/buyers', { id: campaign.id }) },
		{ label: buyerDisplayName(buyer) }
	]}
/>

{#snippet chevron()}
	<svg
		class="shrink-0 text-subtle"
		width="16"
		height="16"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<path d="m9 6 6 6-6 6" />
	</svg>
{/snippet}

{#snippet saleRow(sale: (typeof summary.sales)[number])}
	{@const item = saleById.get(sale.saleId)}
	<li class="border-b border-border" data-sale-row>
		<!-- The whole row is the link to the sale, where its installments and its corrections are. -->
		<a
			class="{rowLink} flex-wrap gap-y-1"
			href={resolve('/campaigns/[id]/sales/[saleId]', { id: campaign.id, saleId: sale.saleId })}
		>
			<span class="flex min-w-0 flex-1 basis-32 items-center">
				<span class="sr-only">Venta del bono </span>
				<BondNumber number={sale.bond} associated={item ? associated(item) || null : null} />
			</span>
			{#if !sale.active}
				<Badge tone="neutral"
					>{item?.sale.status === 'annulled' ? 'Venta anulada' : 'Venta corregida'}</Badge
				>
			{:else if sale.uncollectible}
				<StatusBadge kind="bondFinancial" status="uncollectible" />
			{:else if sale.debtCents > 0}
				<Money
					value={centsToDecimalString(sale.debtCents)}
					class="shrink-0 text-body font-medium"
				/>
			{:else if sale.debt}
				<StatusBadge kind="bondFinancial" status="fully_paid" />
			{/if}
			{@render chevron()}
			<span class="basis-full text-body {sale.active ? '' : 'text-muted'}">
				{`${sale.terms} ${sale.debt ?? ''}`.trim()}
				{#if manyCollectors && sale.active && sale.collectorName}
					<span class="text-muted"
						>{sale.debtCents > 0 ? 'Lo cobra' : 'Lo cobró'} {sale.collectorName}.</span
					>
				{/if}
			</span>
		</a>
	</li>
{/snippet}

{#snippet pendingRow(row: (typeof summary.pending)[number])}
	<li class="flex min-h-14 items-center gap-3 border-b border-border py-2" data-pending-installment>
		<span class="w-14 shrink-0"><BondNumber number={row.bond} /></span>
		<span class="min-w-0 flex-1">
			<span class="block text-body font-medium">Cuota {row.number}</span>
			<span class="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-muted">
				<span>{row.overdue ? 'Venció' : 'Vence'} el {formatDate(row.dueDate)}</span>
				{#if row.overdue}<Badge tone="danger">Vencida</Badge>{/if}
				{#if row.owedCents < Math.round(Number(row.amount) * 100)}
					<span>pago parcial</span>
				{/if}
			</span>
		</span>
		<Money value={centsToDecimalString(row.owedCents)} class="shrink-0 text-body font-medium" />
	</li>
{/snippet}

<div class="flex max-w-[760px] flex-col gap-8">
	<section aria-label="Resumen del comprador" class="flex flex-col gap-3" data-buyer-summary>
		{#if lead}
			<p class="m-0 flex flex-col" data-buyer-lead>
				<span class="text-body-sm text-muted">{lead.label}</span>
				<Money value={lead.value} class="font-figure text-figure-lg" />
			</p>
		{/if}
		<p class="m-0 max-w-[60ch] text-[18px] leading-7 text-text" data-buyer-sentence>
			{#each summary.sentences as parts, i (i)}
				{#each parts as part, j (j)}
					{@const href =
						part.ref === 'collector' && summaryCollectorId
							? collectorHref(summaryCollectorId)
							: null}
					{#if href}
						<a {href} class="rounded-sm font-medium text-primary-text underline underline-offset-2"
							>{part.text}</a
						>
					{:else if part.ref}
						<strong class="font-medium">{part.text}</strong>
					{:else}
						{part.text}
					{/if}
				{/each}{i < summary.sentences.length - 1 ? ' ' : ''}
			{/each}
		</p>
		{#if data.canViewPayments === false && summary.bondCount > 0}
			<p class="m-0 text-body-sm text-muted" data-payments-note>
				Sin permiso para ver los pagos: una cuota con un pago parcial figura por su importe
				completo.
			</p>
		{/if}
		{#if payHref || phone}
			<div class="flex flex-wrap gap-2 pt-1">
				{#if payHref}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved above -->
					<Button href={payHref} variant="primary" size="lg">Registrar pago</Button>
				{/if}
				{#if phone}
					<Button href="tel:{phone.replace(/[^\d+]/g, '')}" size="lg">Llamar al {phone}</Button>
				{/if}
			</div>
		{/if}
		{#if hasFacts}
			<dl class="m-0 grid gap-x-8 gap-y-2 pt-1 text-body sm:grid-cols-2" data-buyer-facts>
				{#if identification}
					<div>
						<dt class="text-body-sm text-muted">
							{buyer.type === 'business' ? 'CUIT' : 'Documento'}
						</dt>
						<dd class="m-0 tabular-nums">{identification}</dd>
					</div>
				{/if}
				{#if usualCollector}
					{@const href = collectorHref(usualCollector.id)}
					<div>
						<dt class="text-body-sm text-muted">Cobrador habitual</dt>
						<dd class="m-0">
							{#if href}
								<a {href} class="rounded-sm text-primary-text underline underline-offset-2"
									>{usualCollector.displayName}</a
								>
							{:else}
								{usualCollector.displayName}
							{/if}
						</dd>
					</div>
				{/if}
				{#if buyer.address}
					<div>
						<dt class="text-body-sm text-muted">Domicilio</dt>
						<dd class="m-0 break-words">{buyer.address}</dd>
					</div>
				{/if}
				{#if buyer.notes}
					<div class="sm:col-span-2">
						<dt class="text-body-sm text-muted">Notas</dt>
						<dd class="m-0 break-words whitespace-pre-wrap">{buyer.notes}</dd>
					</div>
				{/if}
			</dl>
		{/if}
	</section>

	{#if summary.sales.length > 0 || looseBonds.length > 0}
		<section aria-labelledby="bonds-title" id="bonds">
			<h2 id="bonds-title" class="m-0 border-b border-border-strong pb-2 text-heading-3 text-text">
				Bonos comprados <span class="font-normal text-muted">{summary.bondCount}</span>
			</h2>
			{#if summary.sales.length > 0}
				<ul class="m-0 list-none p-0" aria-label="Bonos comprados en esta campaña">
					{#each salesShown as sale (sale.saleId)}{@render saleRow(sale)}{/each}
				</ul>
				{#if salesRest.length > 0}
					<div class="pt-3">
						<Disclosure
							summary={salesRest.length === 1
								? 'Ver la otra venta'
								: `Ver las otras ${salesRest.length} ventas`}
						>
							<ul class="m-0 list-none p-0" aria-label="El resto de las ventas">
								{#each salesRest as sale (sale.saleId)}{@render saleRow(sale)}{/each}
							</ul>
						</Disclosure>
					</div>
				{/if}
			{:else}
				<ul class="m-0 flex list-none flex-wrap gap-x-6 p-0" aria-label="Bonos a su nombre">
					{#each looseBonds as bond (bond.id)}
						<li>
							<BondNumber
								number={bondNumbers(bond)}
								href={resolve('/campaigns/[id]/bonds/[bondId]', {
									id: campaign.id,
									bondId: bond.id
								})}
							/>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}

	{#if summary.pending.length > 0}
		<section aria-labelledby="pending-title" id="installments">
			<h2
				id="pending-title"
				class="m-0 border-b border-border-strong pb-2 text-heading-3 text-text"
			>
				Cuotas por cobrar <span class="font-normal text-muted">{summary.pending.length}</span>
			</h2>
			<ul class="m-0 list-none p-0" aria-label="Cuotas por cobrar, por vencimiento">
				{#each pendingShown as row (`${row.saleId}-${row.number}`)}{@render pendingRow(row)}{/each}
			</ul>
			{#if pendingRest.length > 0}
				<div class="pt-3">
					<Disclosure
						summary={pendingRest.length === 1
							? 'Ver la otra cuota'
							: `Ver las otras ${pendingRest.length} cuotas`}
					>
						<ul class="m-0 list-none p-0" aria-label="El resto de las cuotas por cobrar">
							{#each pendingRest as row (`${row.saleId}-${row.number}`)}{@render pendingRow(
									row
								)}{/each}
						</ul>
					</Disclosure>
				</div>
			{/if}
		</section>
	{/if}

	{#if data.canViewPrizes !== false && prizes.length > 0}
		<section aria-labelledby="prizes-title" id="prizes">
			<h2 id="prizes-title" class="m-0 border-b border-border-strong pb-2 text-heading-3 text-text">
				Premios ganados <span class="font-normal text-muted">{wonCount(prizes)}</span>
			</h2>
			<ul class="m-0 list-none p-0" aria-label="Premios">
				{#each prizes as prize (prize.id)}
					<li class="border-b border-border" data-prize-row>
						<a
							class={rowLink}
							href={resolve('/campaigns/[id]/draws/[drawId]/winners', {
								id: campaign.id,
								drawId: prize.drawId
							})}
						>
							<span class="min-w-0 flex-1">
								<span class="block text-body font-medium"
									>Premio {prize.position}, {prize.name}</span
								>
								<span class="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-muted">
									<span>{prize.drawName}</span>
									{#if prize.deliveredAt}
										<span>Entregado el {formatDateTime(prize.deliveredAt)}</span>
									{/if}
									{#if prize.status === 'annulled'}<span>No cuenta como ganado</span>{/if}
								</span>
							</span>
							<StatusBadge kind="prize" status={prize.status} />
							{@render chevron()}
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<section aria-labelledby="more-title" class="flex flex-col gap-2">
		<h2 id="more-title" class="m-0 border-b border-border-strong pb-2 text-heading-3 text-text">
			Datos e historial
		</h2>

		{#if data.canManage}
			<Disclosure summary="Editar los datos del comprador" defaultOpen={!!form?.message}>
				<BuyerForm
					campaignId={campaign.id}
					{buyer}
					collectors={data.collectors}
					usualCollectorNotVisible={data.usualCollectorNotVisible}
					canViewCollectors={data.canViewCollectors}
					{form}
				/>
			</Disclosure>
		{/if}

		<Disclosure summary="Bonos de otras campañas" meta={String(historicalBonds.length)}>
			{#if historicalBonds.length === 0}
				<p class="m-0 text-body-sm text-muted">No tiene bonos de otras campañas.</p>
			{:else}
				<ul class="m-0 list-none p-0">
					{#each historicalBonds as bond (bond.id)}
						<li class="flex min-h-12 items-center justify-between gap-3 border-b border-border">
							<span class="min-w-0 text-body">{bond.campaignName}</span>
							<BondNumber
								number={bondNumbers(bond)}
								href={resolve('/campaigns/[id]/bonds/[bondId]', {
									id: bond.campaignId,
									bondId: bond.id
								})}
							/>
						</li>
					{/each}
				</ul>
			{/if}
		</Disclosure>

		{#if data.audit}
			<Disclosure summary="Movimientos registrados" meta={String(data.audit.entries.length)}>
				{#if data.audit.entries.length === 0}
					<p class="m-0 text-body-sm text-muted">No hay movimientos de auditoría.</p>
				{:else}
					<ol class="m-0 list-none divide-y divide-border p-0 text-body-sm">
						{#each data.audit.entries as entry (entry.id)}
							<li class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-3">
								<span class="font-medium">{entry.action}</span>
								<span class="text-muted"
									>{entry.actorName ?? 'Usuario desconocido'}, {formatDateTime(
										entry.createdAt
									)}</span
								>
							</li>
						{/each}
					</ol>
				{/if}
			</Disclosure>
		{/if}
	</section>
</div>

<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import InstallmentsList from '$lib/components/sales/InstallmentsList.svelte';
	import {
		Alert,
		Badge,
		Button,
		Dialog,
		Disclosure,
		Field,
		Money,
		PageHeader,
		Select,
		StatusBadge,
		Textarea
	} from '$lib/components/ui';
	import type { BondFinancialStatus } from '$lib/domain/bonds';
	import { campaignNumberingConfig } from '$lib/domain/campaigns';
	import { centsToDecimalString } from '$lib/domain/money';
	import { formatCampaignNumber } from '$lib/domain/numbering';
	import { saleSummary } from '$lib/domain/sale-summary';
	import { SALE_STATUS_LABELS } from '$lib/domain/sales';
	import { formatDateTime } from '$lib/format';
	import { institutionName } from '$lib/institution';
	import type { PageProps } from './$types';

	/**
	 * Sale record (UX plan PR 12b, audit A10). The first screen says who bought which bond, when and
	 * for how much, who collects it and what is still owed, with the one next step; the installments
	 * follow, as on the bond record; the corrections and the uncollectible mark are collapsed
	 * underneath and ask for their reason in a dialog. The four actions and their fields are the same.
	 */
	let { data, form }: PageProps = $props();

	const campaign = $derived(data.campaign);
	const sale = $derived(data.sale.sale);
	const numbering = $derived(campaignNumberingConfig(campaign));
	const bond = $derived(
		data.sale.bondNumberPairs.map(({ base }) => formatCampaignNumber(base, numbering)).join(' + ')
	);
	const associated = $derived(
		data.sale.bondNumberPairs
			.filter(({ associated }) => associated !== null)
			.map(({ associated }) => formatCampaignNumber(associated as number, numbering))
			.join(' + ')
	);

	const summary = $derived(
		saleSummary({
			bond,
			buyerName: data.parties.buyer.name,
			collectorName: data.parties.collector.name,
			soldAt: sale.soldAt,
			totalAmount: sale.totalAmount,
			status: sale.status,
			installments: data.installments.map((item) => ({
				number: item.installmentNumber,
				dueDate: item.dueDate,
				amount: item.amount,
				applied: item.applied,
				status: item.status
			})),
			uncollectible: data.sale.uncollectible !== null,
			today: data.today
		})
	);
	const hrefOf = (ref: 'buyer' | 'collector' | 'bond') =>
		ref === 'bond'
			? resolve('/campaigns/[id]/bonds/[bondId]', { id: campaign.id, bondId: data.sale.bondId })
			: ref === 'buyer'
				? data.parties.buyer.canOpen
					? resolve('/campaigns/[id]/buyers/[buyerId]', {
							id: campaign.id,
							buyerId: data.parties.buyer.id
						})
					: null
				: data.parties.collector.canOpen
					? resolve('/campaigns/[id]/collectors/[collectorId]', {
							id: campaign.id,
							collectorId: data.parties.collector.id
						})
					: null;

	/** The figure the record leads with, and what it is. */
	const lead = $derived.by(() => {
		if (sale.status !== 'active') return { label: 'Total de la venta', value: sale.totalAmount };
		if (summary.debtCents === 0) return { label: 'Pagado', value: sale.totalAmount };
		return {
			label: data.sale.uncollectible ? 'Quedó sin cobrar' : 'Falta cobrar',
			value: centsToDecimalString(summary.debtCents)
		};
	});
	const payHref = $derived(
		data.canPay && summary.collectable
			? `${resolve('/campaigns/[id]/settlements/new', { id: campaign.id })}?intent=payment&collector=${data.parties.collector.id}`
			: null
	);

	// --- Corrections: each one asks for its reason in a dialog ---------------------------------------
	type Kind = 'correctBuyer' | 'correctCollector' | 'markUncollectible' | 'revertUncollectible';
	type Answer = {
		form?: string;
		success?: boolean;
		message?: string;
		values?: Record<string, string>;
		errors?: Record<string, string[] | undefined>;
	};
	const answer = $derived((form ?? null) as Answer | null);
	/** The server's answer when it rejected the dialog's submission. */
	const failure = (kind: Kind) =>
		answer && !answer.success && answer.form === kind ? answer : null;
	// A rejected submission comes back with its dialog open and its values in place.
	// svelte-ignore state_referenced_locally
	let open = $state<Kind | null>(
		answer && !answer.success ? ((answer.form as Kind) ?? null) : null
	);
	// svelte-ignore state_referenced_locally
	let reason = $state(answer && !answer.success ? (answer.values?.reason ?? '') : '');
	// svelte-ignore state_referenced_locally
	let choice = $state(
		answer && !answer.success
			? (answer.values?.newBuyerId ?? answer.values?.newCollectorId ?? '')
			: ''
	);
	let sending = $state(false);
	const ask = (kind: Kind) => {
		reason = '';
		choice = '';
		open = kind;
	};
	const close = () => (open = null);
	/** Posts the dialog without leaving the page: it closes on success and stays open on an error. */
	const submit = (node: HTMLFormElement) =>
		enhance(node, () => {
			sending = true;
			return async ({ result, update }) => {
				sending = false;
				if (result.type === 'success' || result.type === 'redirect') open = null;
				await update({ reset: false });
			};
		});

	const buyerLabel = (buyer: {
		firstName: string | null;
		lastName: string | null;
		businessName: string | null;
	}) => buyer.businessName ?? [buyer.firstName, buyer.lastName].filter(Boolean).join(' ');
	const buyerOptions = $derived(
		(data.correction?.buyers ?? [])
			.filter((buyer) => buyer.id !== data.parties.buyer.id)
			.map((buyer) => ({ value: buyer.id, label: buyerLabel(buyer) }))
	);
	const collectorOptions = $derived(
		(data.correction?.collectors ?? [])
			.filter((collector) => collector.id !== data.parties.collector.id)
			.map((collector) => ({ value: collector.id, label: collector.displayName }))
	);
	const today = (name: string | null, fallback: string) =>
		name ? `Hoy figura ${name}.` : fallback;
	const canChange = $derived(
		!!data.correction || data.canMarkUncollectible || data.canRevertUncollectible
	);
	const row = 'flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3';
</script>

<svelte:head>
	<title>Venta del bono {bond} - {campaign.name} - {institutionName()}</title>
</svelte:head>

<PageHeader
	title="Venta del bono {bond}"
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: campaign.name, href: resolve('/campaigns/[id]', { id: campaign.id }) },
		{ label: 'Ventas', href: resolve('/campaigns/[id]/sales', { id: campaign.id }) },
		{ label: bond }
	]}
/>

{#snippet reasonField(kind: Kind)}
	{#if failure(kind)?.message && !failure(kind)?.errors?.reason?.length}
		<Alert tone="danger">{failure(kind)?.message}</Alert>
	{/if}
	<Field
		label="Motivo"
		id="{kind}-reason"
		required
		hint="Hasta 1000 caracteres."
		error={failure(kind)?.errors?.reason?.[0]}
	>
		<Textarea name="reason" rows={3} bind:value={reason} />
	</Field>
{/snippet}

<div class="flex max-w-[760px] flex-col gap-8">
	{#if answer?.success}
		<Alert tone="success">{answer.message}</Alert>
	{:else if answer?.message && !open}
		<Alert tone="danger">{answer.message}</Alert>
	{/if}

	<section aria-label="Resumen de la venta" class="flex flex-col gap-3" data-sale-summary>
		<p class="m-0 flex flex-col" data-sale-lead>
			<span class="text-body-sm text-muted">{lead.label}</span>
			<Money value={lead.value} class="font-figure text-figure-lg" />
		</p>
		<p class="m-0 max-w-[60ch] text-[18px] leading-7 text-text" data-sale-sentence>
			{#each summary.sentences as parts, i (i)}
				{#each parts as part, j (j)}
					{@const href = part.ref ? hrefOf(part.ref) : null}
					{#if href}
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved above -->
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
		{#if associated}
			<p class="m-0 text-body-sm text-muted">Número asociado {associated}</p>
		{/if}
		<div class="flex flex-wrap gap-2">
			{#if sale.status === 'active'}
				<StatusBadge kind="bondFinancial" status={data.financialStatus as BondFinancialStatus} />
			{:else}
				<Badge tone="neutral">{SALE_STATUS_LABELS[sale.status]}</Badge>
			{/if}
		</div>
		{#if data.sale.uncollectible}
			<Alert tone="warning" title="Venta incobrable">
				Marcada el {formatDateTime(data.sale.uncollectible.markedAt)}. Motivo: {data.sale
					.uncollectible.reason}
			</Alert>
		{/if}
		{#if payHref}
			<div class="flex flex-wrap gap-2 pt-1">
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved above -->
				<Button href={payHref} variant="primary" size="lg">Registrar pago</Button>
			</div>
		{/if}
	</section>

	{#if summary.rows.length > 0}
		<section aria-labelledby="installments-title" id="installments">
			<h2 id="installments-title" class="m-0 border-b border-border-strong pb-2 text-heading-3">
				{summary.rows.length === 1 ? 'Pago' : 'Cuotas'}
			</h2>
			<InstallmentsList
				rows={summary.rows}
				payments={data.installments}
				debtCents={summary.debtCents}
				totalAmount={sale.totalAmount}
				canViewPayments={data.canViewPayments}
				closing={false}
				label="Cuotas de la venta"
			/>
		</section>
	{/if}

	{#if canChange}
		<Disclosure summary="Corregir la venta">
			<p class="m-0 pb-1 text-body-sm text-muted">
				Cada cambio pide un motivo y queda en la auditoría.
			</p>
			<div class="divide-y divide-border" data-sale-corrections>
				{#if data.correction}
					<div class={row}>
						<p class="m-0 min-w-0 flex-1 basis-56 text-body">
							La venta figura a nombre de otro comprador.
						</p>
						<Button onclick={() => ask('correctBuyer')}>Corregir el comprador</Button>
					</div>
					<div class={row}>
						<p class="m-0 min-w-0 flex-1 basis-56 text-body">La vendió otro cobrador.</p>
						<Button onclick={() => ask('correctCollector')}>Corregir el cobrador</Button>
					</div>
				{/if}
				{#if data.canMarkUncollectible}
					<div class={row}>
						<p class="m-0 min-w-0 flex-1 basis-56 text-body">Ya no se va a poder cobrar.</p>
						<Button onclick={() => ask('markUncollectible')}>Marcar como incobrable</Button>
					</div>
				{/if}
				{#if data.canRevertUncollectible}
					<div class={row}>
						<p class="m-0 min-w-0 flex-1 basis-56 text-body">
							Se marcó como incobrable por error, o se volvió a cobrar.
						</p>
						<Button onclick={() => ask('revertUncollectible')}>Revertir la marca</Button>
					</div>
				{/if}
			</div>
		</Disclosure>
	{/if}
</div>

{#if data.correction}
	<Dialog
		open={open === 'correctBuyer'}
		onClose={close}
		action="?/correctBuyer"
		enhance={submit}
		loading={sending}
		title="¿Corregir el comprador de la venta del bono {bond}?"
		description="{today(
			data.parties.buyer.name,
			''
		)} Cambiar el comprador no mueve la cuenta corriente: las cuotas y los pagos siguen en la misma venta."
		confirmLabel="Corregir el comprador"
		confirmDisabled={!choice || !reason.trim()}
	>
		{#if open === 'correctBuyer'}
			<Field label="Comprador correcto" id="newBuyerId" required>
				<Select
					name="newBuyerId"
					placeholder="Elegir…"
					options={buyerOptions}
					bind:value={choice}
				/>
			</Field>
			{#if (data.correction.buyersTotal ?? 0) > data.correction.buyers.length}
				<p class="m-0 text-body-sm text-muted" data-testid="buyers-truncated">
					Se muestran los primeros {data.correction.buyers.length} de {data.correction.buyersTotal}
					compradores. Si falta el correcto, abrir su ficha desde el listado de compradores.
				</p>
			{/if}
			{@render reasonField('correctBuyer')}
		{/if}
	</Dialog>
	<Dialog
		open={open === 'correctCollector'}
		onClose={close}
		action="?/correctCollector"
		enhance={submit}
		loading={sending}
		title="¿Corregir el cobrador de la venta del bono {bond}?"
		description="{today(
			data.parties.collector.name,
			''
		)} Cambiar el cobrador compensa la comisión histórica entre cobradores según la prioridad de reglas vigente; los cálculos guardados en la base de datos son los que valen."
		confirmLabel="Corregir el cobrador"
		confirmDisabled={!choice || !reason.trim()}
	>
		{#if open === 'correctCollector'}
			<Field label="Cobrador correcto" id="newCollectorId" required>
				<Select
					name="newCollectorId"
					placeholder="Elegir…"
					options={collectorOptions}
					bind:value={choice}
				/>
			</Field>
			{@render reasonField('correctCollector')}
		{/if}
	</Dialog>
{/if}
{#if data.canMarkUncollectible}
	<Dialog
		open={open === 'markUncollectible'}
		onClose={close}
		action="?/markUncollectible"
		enhance={submit}
		loading={sending}
		tone="danger"
		title="¿Marcar como incobrable la venta del bono {bond}?"
		description="La venta pasa a estado financiero «Incobrable» aunque después se registren pagos. Solo un administrador puede revertir la marca."
		confirmLabel="Marcar como incobrable"
		confirmDisabled={!reason.trim()}
	>
		{#if open === 'markUncollectible'}{@render reasonField('markUncollectible')}{/if}
	</Dialog>
{/if}
{#if data.canRevertUncollectible}
	<Dialog
		open={open === 'revertUncollectible'}
		onClose={close}
		action="?/revertUncollectible"
		enhance={submit}
		loading={sending}
		title="¿Revertir la marca de incobrable de la venta del bono {bond}?"
		description="La venta vuelve al estado que le dan sus cuotas. La marca anterior y este motivo quedan en la auditoría."
		confirmLabel="Revertir la marca"
		confirmDisabled={!reason.trim()}
	>
		{#if open === 'revertUncollectible'}{@render reasonField('revertUncollectible')}{/if}
	</Dialog>
{/if}

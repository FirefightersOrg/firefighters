<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import CollectorForm from '$lib/components/collectors/CollectorForm.svelte';
	import {
		Alert,
		Badge,
		BondNumber,
		Button,
		Checkbox,
		Dialog,
		Disclosure,
		Field,
		Money,
		PageHeader,
		Select,
		StatusBadge,
		Table,
		statusMeta
	} from '$lib/components/ui';
	import type { TableColumn } from '$lib/components/ui';
	import type { BondFinancialStatus } from '$lib/domain/bonds';
	import { campaignNumberingConfig } from '$lib/domain/campaigns';
	import { collectorSummary } from '$lib/domain/collector-summary';
	import {
		describeCommissionRuleType,
		describeCommissionValue,
		describeValidity
	} from '$lib/domain/commissions';
	import { deliveryNoteLabel } from '$lib/domain/deliveries';
	import { centsToDecimalString } from '$lib/domain/money';
	import { formatCampaignNumber } from '$lib/domain/numbering';
	import { buyerDisplayName, NO_ACCESS_BUYER } from '$lib/domain/parties';
	import { formatDate, formatDateTime } from '$lib/format';
	import { institutionName } from '$lib/institution';
	import type { PageProps } from './$types';

	/**
	 * Collector record (UX plan PR 15, audit A12). The first screen says how many bonds the collector
	 * has, what is left to collect and what the current account says, with the one next step; then
	 * the first rows of what is owed, of the bonds and of the settlements, each with the way to the
	 * rest; the data, the history and the bulk return and reassignment are collapsed underneath. The
	 * three actions (`update`, `returnBonds`, `reassignBonds`) and their fields are the same.
	 */
	let { data, form }: PageProps = $props();

	/** How many rows of a list the record shows before the rest is collapsed or linked. */
	const SHOWN = 10;
	/**
	 * Unsold bonds are shown by number, five to a line on a phone: three lines of them take less room
	 * than two lines and a control to open the rest.
	 */
	const UNSOLD_SHOWN = 15;

	const campaign = $derived(data.campaign);
	const collector = $derived(data.collector);
	const numbering = $derived(campaignNumberingConfig(campaign));
	const padded = (numbers: readonly number[]) =>
		numbers.map((number) => formatCampaignNumber(number, numbering)).join(' + ');

	const debts = $derived(data.debts ?? []);
	const summary = $derived(
		collectorSummary({
			name: collector.displayName,
			bondsTotal: data.bondsTotal,
			bonds: data.bonds,
			debts,
			balance: data.ledger?.balance ?? null,
			today: data.today
		})
	);
	const ledgerHref = $derived(
		data.ledger
			? resolve('/campaigns/[id]/collectors/[collectorId]/ledger', {
					id: campaign.id,
					collectorId: collector.id
				})
			: null
	);
	const settlements = $derived(data.settlements ?? []);
	const openSettlement = $derived(settlements.find((settlement) => settlement.status === 'open'));
	const deliverHref = $derived(
		data.can.deliver && collector.status === 'active'
			? resolve('/campaigns/[id]/deliveries/new', { id: campaign.id })
			: null
	);
	/** The one next step that fits the state, when the role may take it. */
	const nextStep = $derived.by(() => {
		if (summary.nextStep === 'pay' && data.can.pay)
			return openSettlement
				? {
						label: `Cargar pagos en la rendición ${openSettlement.settlementNumber}`,
						href: resolve('/campaigns/[id]/settlements/[settlementId]', {
							id: campaign.id,
							settlementId: openSettlement.id
						})
					}
				: {
						label: 'Registrar pago',
						href: `${resolve('/campaigns/[id]/settlements/new', { id: campaign.id })}?intent=payment&collector=${collector.id}`
					};
		if (summary.nextStep === 'deliver' && deliverHref)
			return { label: 'Entregar bonos', href: deliverHref };
		return null;
	});
	const phone = $derived(collector.phone?.trim() || null);
	const rowLink =
		'flex min-h-14 items-center gap-3 rounded-sm py-2 text-text no-underline hover:bg-surface-hover';

	// --- What is owed: unpaid installments by due date -------------------------------------------
	const overdue = (debt: { status: string; dueDate: string }) =>
		debt.status === 'overdue' || debt.dueDate < data.today;
	const debtsShown = $derived(debts.slice(0, SHOWN));
	const debtsRest = $derived(debts.slice(SHOWN));
	const salesHref = $derived(
		`${resolve('/campaigns/[id]/sales', { id: campaign.id })}?collector=${collector.id}`
	);

	// --- Bonds: the ones still in the collector's hands, then the rest --------------------------
	type Bond = (typeof data.bonds)[number];
	const unsold = (bond: Bond) => bond.commercialStatus === 'delivered_to_collector';
	const unsoldBonds = $derived(data.bonds.filter(unsold));
	const otherBonds = $derived(data.bonds.filter((bond) => !unsold(bond)));
	const allSold = $derived(otherBonds.every((bond) => bond.commercialStatus === 'sold'));
	/** The delivery notes the unsold bonds came with, by number. */
	const unsoldNotes = $derived(
		[
			...new Map(
				unsoldBonds.flatMap((bond) => (bond.note ? [[bond.note.noteId, bond.note] as const] : []))
			).values()
		].sort((a, b) => a.noteNumber - b.noteNumber)
	);
	const bondWord = (bond: Bond) => statusMeta('bondCommercial', bond.commercialStatus).label;
	const bondsCount = (count: number) => `${count} ${count === 1 ? 'bono' : 'bonos'}`;
	const bondHref = (bond: Bond) =>
		resolve('/campaigns/[id]/bonds/[bondId]', { id: campaign.id, bondId: bond.id });

	// --- Settlements -----------------------------------------------------------------------------
	const settlementsHref = $derived(
		`${resolve('/campaigns/[id]/settlements', { id: campaign.id })}?collector=${collector.id}`
	);

	// --- Special commission rules ----------------------------------------------------------------
	const ruleRows = $derived(
		(data.specialRules ?? []).map((rule) => ({
			id: rule.id,
			type: describeCommissionRuleType(rule),
			commission: describeCommissionValue(rule),
			validity: describeValidity(rule),
			status: rule.status
		}))
	);
	type RuleRow = (typeof ruleRows)[number];
	const ruleColumns: TableColumn<RuleRow>[] = [
		{ key: 'type', header: 'Tipo', stack: 'primary' },
		{ key: 'commission', header: 'Comisión', align: 'right', stack: 'trailing' },
		{ key: 'validity', header: 'Vigencia', stack: 'secondary' },
		{ key: 'status', header: 'Estado', stack: 'secondary' }
	];

	// --- Forms -----------------------------------------------------------------------------------
	/** A bulk return or reassignment the server rejected (its errors belong to that block). */
	const custodyForm = $derived(
		form && 'form' in form && form.form === 'custody'
			? (form as { message?: string; errors?: Record<string, string[]> })
			: null
	);
	const collectorForm = $derived(
		custodyForm
			? null
			: ((form ?? null) as {
					success?: boolean;
					message?: string;
					values?: Record<string, string>;
					errors?: Record<string, string[]>;
				} | null)
	);

	// Bulk return and reassignment: the bonds the collector still has are chosen here and posted to
	// the same two actions; with JavaScript a dialog names how many and to whom before posting.
	const canBulk = $derived(data.custody.can.returnBonds || data.custody.can.reassignBonds);
	const selectable = $derived(unsoldBonds);
	let selected = $state<string[]>([]);
	let target = $state('');
	let custodyFormElement = $state<HTMLFormElement>();
	let asking = $state<{ kind: 'return' | 'reassign'; submitter: HTMLElement } | null>(null);
	let sending = $state<'return' | 'reassign' | null>(null);
	const toggle = (id: string, checked: boolean) => {
		selected = checked ? [...new Set([...selected, id])] : selected.filter((item) => item !== id);
	};
	const targetName = $derived(
		data.custody.collectors.find((option) => option.id === target)?.displayName ?? ''
	);
	/** Asks before posting. With nothing chosen the form posts, and the server says what is missing. */
	function ask(kind: 'return' | 'reassign', event: MouseEvent) {
		if (selected.length === 0 || (kind === 'reassign' && !target)) return;
		event.preventDefault();
		asking = { kind, submitter: event.currentTarget as HTMLElement };
	}
	function confirm() {
		const pending = asking;
		asking = null;
		if (!pending || !custodyFormElement) return;
		sending = pending.kind;
		custodyFormElement.requestSubmit(pending.submitter);
	}
	const selectedNumbers = $derived(
		selectable.filter((bond) => selected.includes(bond.id)).map((bond) => padded(bond.baseNumbers))
	);
	const chosen = $derived(
		selected.length === 1 ? `el bono ${selectedNumbers[0] ?? ''}` : bondsCount(selected.length)
	);
</script>

<svelte:head>
	<title>{collector.displayName} - {campaign.name} - {institutionName()}</title>
</svelte:head>

<PageHeader
	title={collector.displayName}
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: campaign.name, href: resolve('/campaigns/[id]', { id: campaign.id }) },
		{ label: 'Cobradores', href: resolve('/campaigns/[id]/collectors', { id: campaign.id }) },
		{ label: collector.displayName }
	]}
/>

{#snippet bondChips(list: Bond[], label: string)}
	<ul class="m-0 flex list-none flex-wrap gap-x-5 p-0" aria-label={label}>
		{#each list as bond (bond.id)}
			<li data-unsold-bond>
				<BondNumber number={padded(bond.baseNumbers)} href={bondHref(bond)} />
			</li>
		{/each}
	</ul>
{/snippet}

{#snippet bondRow(bond: Bond)}
	<li class="flex min-h-14 items-center gap-3 border-b border-border py-1.5" data-bond-row>
		<span class="w-28 shrink-0">
			<BondNumber
				number={padded(bond.baseNumbers)}
				associated={bond.kind === 'simple' ? padded(bond.associatedNumbers) : null}
				href={bondHref(bond)}
			/>
		</span>
		<span class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-body">
			<span>{bond.kind === 'pata' ? `Pata, ${bondWord(bond).toLowerCase()}` : bondWord(bond)}</span>
			{#if bond.commercialStatus === 'sold'}
				<StatusBadge kind="bondFinancial" status={bond.financialStatus as BondFinancialStatus} />
			{/if}
		</span>
	</li>
{/snippet}

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

{#snippet debtRow(debt: (typeof debts)[number])}
	<li class="border-b border-border" data-debt-row>
		<!-- The whole row is the link to the sale: one 56 px target that says everything it shows. -->
		<a
			class="grid min-h-14 grid-cols-[3.5rem_minmax(0,1fr)_auto_auto] items-center gap-x-3 rounded-sm py-2 text-text no-underline hover:bg-surface-hover"
			href={resolve('/campaigns/[id]/sales/[saleId]', { id: campaign.id, saleId: debt.saleId })}
		>
			<span class="row-span-2"><BondNumber number={padded(debt.bondNumbers)} /></span>
			<span class="truncate text-body font-medium">{debt.buyerName ?? NO_ACCESS_BUYER}</span>
			<Money value={debt.owed} class="text-body font-medium" />
			{@render chevron()}
			<span
				class="col-span-3 col-start-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-muted"
			>
				<span
					>Cuota {debt.number}, {overdue(debt) ? 'venció' : 'vence'} el {formatDate(
						debt.dueDate
					)}</span
				>
				{#if debt.uncollectible}
					<Badge tone="danger">Incobrable</Badge>
				{:else if overdue(debt)}
					<Badge tone="danger">Vencida</Badge>
				{/if}
			</span>
		</a>
	</li>
{/snippet}

<div class="flex max-w-[760px] flex-col gap-8">
	<section aria-label="Resumen del cobrador" class="flex flex-col gap-3" data-collector-summary>
		{#if summary.debtCents > 0}
			<p class="m-0 flex flex-col" data-collector-lead>
				<span class="text-body-sm text-muted">Falta cobrar</span>
				<Money value={centsToDecimalString(summary.debtCents)} class="font-figure text-figure-lg" />
			</p>
		{/if}
		<p class="m-0 max-w-[60ch] text-[18px] leading-7 text-text" data-collector-sentence>
			{#each summary.sentences as parts, i (i)}
				{#each parts as part, j (j)}
					{#if part.ref === 'ledger' && ledgerHref}
						<a
							href={ledgerHref}
							class="rounded-sm font-medium text-primary-text underline underline-offset-2"
							>{part.text}</a
						>
					{:else}
						{part.text}
					{/if}
				{/each}{i < summary.sentences.length - 1 ? ' ' : ''}
			{/each}
		</p>
		{#if !data.can.viewPayments && debts.length > 0}
			<p class="m-0 text-body-sm text-muted" data-payments-note>
				Sin permiso para ver los pagos: una cuota con un pago parcial, o con un pago que todavía no
				se confirmó, figura por su importe completo.
			</p>
		{/if}
		{#if collector.status === 'inactive'}
			<div class="flex flex-wrap gap-2">
				<StatusBadge kind="collector" status={collector.status} />
			</div>
		{/if}
		{#if nextStep || ledgerHref || phone}
			<div class="flex flex-wrap gap-2 pt-1">
				{#if nextStep}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved above -->
					<Button href={nextStep.href} variant="primary" size="lg">{nextStep.label}</Button>
				{/if}
				{#if ledgerHref}
					<Button href={ledgerHref} size="lg">Ver cuenta corriente</Button>
				{/if}
				{#if phone}
					<Button href="tel:{phone.replace(/[^\d+]/g, '')}" size="lg">Llamar al {phone}</Button>
				{/if}
			</div>
		{/if}
		{#if collector.email || collector.address}
			<p class="m-0 text-body-sm break-words text-muted" data-collector-contact>
				{[collector.email, collector.address].filter(Boolean).join(', ')}
			</p>
		{/if}
	</section>

	{#if debts.length > 0}
		<section aria-labelledby="debts-title" id="debts">
			<div class="flex items-center justify-between gap-3 border-b border-border-strong">
				<h2 id="debts-title" class="m-0 py-2 text-heading-3 text-text">
					Cuotas por cobrar <span class="font-normal text-muted">{debts.length}</span>
				</h2>
				<!-- eslint-disable svelte/no-navigation-without-resolve -- resolved above -->
				<a
					class="inline-flex min-h-touch items-center rounded-sm text-body-sm text-primary-text underline underline-offset-2"
					href={salesHref}>Ver sus ventas</a
				>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			</div>
			<ul class="m-0 list-none p-0" aria-label="Cuotas por cobrar, por vencimiento">
				{#each debtsShown as debt (debt.id)}{@render debtRow(debt)}{/each}
			</ul>
			{#if debtsRest.length > 0}
				<div class="pt-3">
					<Disclosure
						summary={debtsRest.length === 1
							? 'Ver la otra cuota'
							: `Ver las otras ${debtsRest.length} cuotas`}
					>
						<ul class="m-0 list-none p-0" aria-label="El resto de las cuotas por cobrar">
							{#each debtsRest as debt (debt.id)}{@render debtRow(debt)}{/each}
						</ul>
					</Disclosure>
				</div>
			{/if}
		</section>
	{/if}

	<section aria-labelledby="bonds-title" id="bonds">
		<div class="flex items-center justify-between gap-3 border-b border-border-strong">
			<h2 id="bonds-title" class="m-0 py-2 text-heading-3 text-text">
				Bonos <span class="font-normal text-muted">{data.bondsTotal}</span>
			</h2>
			{#if data.bondsTotal > 0}
				<a
					class="inline-flex min-h-touch items-center rounded-sm text-body-sm text-primary-text underline underline-offset-2"
					href="{resolve('/campaigns/[id]/bonds', { id: campaign.id })}?collector={collector.id}"
					data-collector-bonds-link>Ver todos sus bonos</a
				>
			{/if}
			{#if deliverHref && nextStep?.href !== deliverHref}
				<a
					class="inline-flex min-h-touch items-center rounded-sm text-body-sm text-primary-text underline underline-offset-2"
					href={deliverHref}>Entregar bonos</a
				>
			{/if}
		</div>
		{#if data.bonds.length === 0}
			<p class="m-0 py-3 text-body text-muted">No tiene bonos de esta campaña.</p>
		{:else}
			<div class="flex flex-col gap-2 pt-2">
				{#if unsoldBonds.length === 0}
					<p class="m-0 py-1 text-body text-muted">No le quedan bonos sin vender.</p>
				{:else}
					<h3 class="m-0 text-body font-normal text-muted">
						Sin vender: {unsoldBonds.length}
					</h3>
					{@render bondChips(unsoldBonds.slice(0, UNSOLD_SHOWN), 'Bonos sin vender')}
					{#if unsoldBonds.length > UNSOLD_SHOWN}
						<Disclosure
							summary={unsoldBonds.length - UNSOLD_SHOWN === 1
								? 'Ver el otro bono sin vender'
								: `Ver los otros ${unsoldBonds.length - UNSOLD_SHOWN} bonos sin vender`}
						>
							{@render bondChips(
								unsoldBonds.slice(UNSOLD_SHOWN),
								'El resto de los bonos sin vender'
							)}
						</Disclosure>
					{/if}
					{#if unsoldNotes.length > 0}
						<p class="m-0 text-body-sm text-muted" data-unsold-notes>
							{unsoldNotes.length === 1 ? 'Entregados con el' : 'Entregados con los remitos'}
							{#each unsoldNotes as note, i (note.noteId)}
								{i === 0 ? '' : i === unsoldNotes.length - 1 ? ' y ' : ', '}<a
									class="rounded-sm text-primary-text underline underline-offset-2"
									href={resolve('/campaigns/[id]/deliveries/[noteId]', {
										id: campaign.id,
										noteId: note.noteId
									})}
									>{unsoldNotes.length === 1
										? deliveryNoteLabel(note.noteNumber).toLowerCase()
										: deliveryNoteLabel(note.noteNumber).replace('Remito ', '')}</a
								>{/each}.
						</p>
					{/if}
				{/if}
				{#if otherBonds.length > 0}
					<Disclosure
						summary={allSold ? 'Bonos vendidos' : 'Bonos vendidos o en otro estado'}
						meta={String(otherBonds.length)}
					>
						<ul class="m-0 list-none p-0" aria-label="Bonos vendidos del cobrador">
							{#each otherBonds as bond (bond.id)}{@render bondRow(bond)}{/each}
						</ul>
					</Disclosure>
				{/if}
				{#if data.bondsTotal > data.bonds.length}
					<p class="m-0 text-body-sm text-muted">
						Se listan los primeros {data.bonds.length} de {data.bondsTotal} bonos.
					</p>
				{/if}
			</div>
		{/if}
	</section>

	{#if data.can.viewSettlements}
		<section aria-labelledby="settlements-title" id="settlements">
			<div class="flex items-center justify-between gap-3 border-b border-border-strong">
				<h2 id="settlements-title" class="m-0 py-2 text-heading-3 text-text">
					Rendiciones <span class="font-normal text-muted">{settlements.length}</span>
				</h2>
				{#if settlements.length > SHOWN}
					<!-- eslint-disable svelte/no-navigation-without-resolve -- resolved above -->
					<a
						class="inline-flex min-h-touch items-center rounded-sm text-body-sm text-primary-text underline underline-offset-2"
						href={settlementsHref}>Ver las {settlements.length} rendiciones</a
					>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{/if}
			</div>
			{#if settlements.length === 0}
				<p class="m-0 py-3 text-body text-muted">Todavía no tiene rendiciones.</p>
			{:else}
				<ul
					class="m-0 list-none p-0"
					aria-label="Rendiciones del cobrador, de la más reciente a la más antigua"
				>
					{#each settlements.slice(0, SHOWN) as settlement (settlement.id)}
						<li class="border-b border-border" data-settlement-row>
							<a
								class={rowLink}
								href={resolve('/campaigns/[id]/settlements/[settlementId]', {
									id: campaign.id,
									settlementId: settlement.id
								})}
							>
								<span class="min-w-0 flex-1">
									<span class="block text-body font-medium"
										>Rendición {settlement.settlementNumber}</span
									>
									<span class="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-muted">
										<StatusBadge kind="settlement" status={settlement.status} />
										<span
											>{settlement.closedAt
												? `Cerrada el ${formatDate(settlement.closedAt)}`
												: `Abierta el ${formatDate(settlement.openedAt)}`}</span
										>
									</span>
								</span>
								{#if settlement.status !== 'open'}
									<Money
										value={settlement.totals.totalAmount}
										class="shrink-0 text-body font-medium"
									/>
								{/if}
								{@render chevron()}
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}

	<section aria-labelledby="more-title" class="flex flex-col gap-2">
		<h2 id="more-title" class="m-0 border-b border-border-strong pb-2 text-heading-3 text-text">
			Datos y correcciones
		</h2>

		{#if data.can.manage}
			<Disclosure summary="Editar los datos del cobrador" defaultOpen={!!collectorForm?.message}>
				<CollectorForm
					{collector}
					profiles={data.profiles}
					form={collectorForm}
					action="?/update"
					submitLabel="Guardar cambios"
				/>
			</Disclosure>
		{/if}

		{#if data.buyers.length > 0}
			<Disclosure summary="Compradores habituales" meta={String(data.buyersTotal)}>
				<ul class="m-0 grid list-none gap-x-6 p-0 sm:grid-cols-2">
					{#each data.buyers as buyer (buyer.id)}
						<li>
							<a
								class="inline-flex min-h-touch items-center rounded-sm text-body text-primary-text underline underline-offset-2"
								href={resolve('/campaigns/[id]/buyers/[buyerId]', {
									id: campaign.id,
									buyerId: buyer.id
								})}>{buyerDisplayName(buyer)}</a
							>
						</li>
					{/each}
				</ul>
				{#if data.buyersTotal > data.buyers.length}
					<p class="m-0 mt-2 text-body-sm text-muted">
						y {data.buyersTotal - data.buyers.length} más
					</p>
				{/if}
			</Disclosure>
		{/if}

		{#if data.can.viewRules}
			<Disclosure summary="Reglas especiales de comisión" meta={String(ruleRows.length)}>
				<div data-testid="special-rules">
					{#if ruleRows.length === 0}
						<p class="m-0 text-body-sm text-muted">
							No tiene reglas especiales: cobra la comisión general de la campaña.
						</p>
					{:else}
						<Table
							columns={ruleColumns}
							rows={ruleRows}
							caption="Reglas especiales de comisión"
							density="compact"
							stack
						>
							{#snippet cell({ row, column })}
								{#if column.key === 'status'}
									<StatusBadge kind="commissionRule" status={row.status} />
								{:else}
									{row[column.key as keyof RuleRow]}
								{/if}
							{/snippet}
						</Table>
					{/if}
				</div>
				{#if data.can.manageRules}
					<div class="mt-3">
						<Button href={resolve('/campaigns/[id]/commissions', { id: campaign.id })}
							>Gestionar reglas especiales</Button
						>
					</div>
				{/if}
			</Disclosure>
		{/if}

		{#if data.can.audit && data.audit}
			<Disclosure summary="Movimientos registrados" meta={String(data.audit.entries.length)}>
				{#if data.audit.entries.length === 0}
					<p class="m-0 text-body-sm text-muted">
						No hay movimientos de auditoría para este cobrador.
					</p>
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

		{#if canBulk && selectable.length > 0}
			<Disclosure summary="Devolver o reasignar bonos" defaultOpen={!!custodyForm}>
				<form
					method="POST"
					class="flex flex-col gap-4"
					bind:this={custodyFormElement}
					data-custody-form
					use:enhance={() => {
						return async ({ update }) => {
							sending = null;
							await update({ reset: false });
						};
					}}
				>
					<p class="m-0 text-body-sm text-muted">
						{selectable.length === 1
							? `${collector.displayName} tiene 1 bono sin vender.`
							: `${collector.displayName} tiene ${selectable.length} bonos sin vender.`}
						Devolverlos los deja disponibles para entregar; reasignarlos los pasa a otro cobrador. Cada
						operación emite su remito.
					</p>
					{#if custodyForm?.message}
						<Alert tone="danger">{custodyForm.message}</Alert>
					{/if}
					<fieldset class="m-0 border-0 p-0">
						<legend class="mb-1 p-0 text-label text-text">Bonos sin vender</legend>
						<div class="grid grid-cols-2 gap-x-4 sm:grid-cols-4">
							{#each selectable as bond (bond.id)}
								<Checkbox
									name="bondIds"
									value={bond.id}
									label={padded(bond.baseNumbers)}
									checked={selected.includes(bond.id)}
									onchange={(event) => toggle(bond.id, event.currentTarget.checked)}
								/>
							{/each}
						</div>
					</fieldset>
					{#if data.custody.can.returnBonds}
						<div>
							<Button
								type="submit"
								formaction="?/returnBonds"
								loading={sending === 'return'}
								onclick={(event) => ask('return', event)}
								>{selected.length > 0
									? `Devolver ${bondsCount(selected.length)}`
									: 'Devolver seleccionados'}</Button
							>
						</div>
					{/if}
					{#if data.custody.can.reassignBonds}
						<div class="flex flex-wrap items-end gap-3">
							<div class="min-w-56 flex-1">
								<Field
									label="Reasignar seleccionados a"
									id="targetCollectorId"
									error={custodyForm?.errors?.targetCollectorId?.[0]}
								>
									<Select
										name="targetCollectorId"
										bind:value={target}
										options={[
											{ value: '', label: 'Elegir cobrador…' },
											...data.custody.collectors.map((option) => ({
												value: option.id,
												label: option.displayName
											}))
										]}
									/>
								</Field>
							</div>
							<Button
								type="submit"
								formaction="?/reassignBonds"
								loading={sending === 'reassign'}
								onclick={(event) => ask('reassign', event)}
								>{selected.length > 0
									? `Reasignar ${bondsCount(selected.length)}`
									: 'Reasignar'}</Button
							>
						</div>
					{/if}
				</form>
			</Disclosure>
		{/if}

		{#if data.can.viewReports}
			<p class="m-0">
				<a
					class="inline-flex min-h-touch items-center rounded-sm text-body-sm text-primary-text underline underline-offset-2"
					href="{resolve('/campaigns/[id]/reports', {
						id: campaign.id
					})}?collector={collector.id}#monthly-title">Resumen operativo mensual</a
				>
			</p>
		{/if}
	</section>
</div>

{#if canBulk}
	<Dialog
		open={asking !== null}
		onClose={() => (asking = null)}
		onConfirm={confirm}
		title={asking?.kind === 'reassign'
			? `¿Reasignar ${chosen} de ${collector.displayName} a ${targetName}?`
			: `¿Devolver ${chosen} de ${collector.displayName}?`}
		description={asking?.kind === 'reassign'
			? `${selected.length === 1 ? 'Pasa' : 'Pasan'} a manos de ${targetName}. Se emite un remito de reasignación.`
			: `${selected.length === 1 ? 'Vuelve a estar disponible' : 'Vuelven a estar disponibles'} para entregar. Se emite un remito de devolución.`}
		confirmLabel={asking?.kind === 'reassign'
			? `Reasignar ${bondsCount(selected.length)}`
			: `Devolver ${bondsCount(selected.length)}`}
	>
		{#if selected.length > 1 && selected.length <= 12}
			<p class="m-0 text-body-sm text-muted" data-chosen-bonds>
				Bonos {selectedNumbers.join(', ')}.
			</p>
		{/if}
	</Dialog>
{/if}

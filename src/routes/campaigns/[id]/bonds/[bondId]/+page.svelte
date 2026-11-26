<script lang="ts">
	import { institutionName } from '$lib/institution';
	import { resolve } from '$app/paths';
	import BondActionsSection from '$lib/components/bonds/record/BondActionsSection.svelte';
	import BondAuditSection from '$lib/components/bonds/record/BondAuditSection.svelte';
	import BondBarcodeSection from '$lib/components/bonds/record/BondBarcodeSection.svelte';
	import BondCustodySection from '$lib/components/bonds/record/BondCustodySection.svelte';
	import BondGeneralSection from '$lib/components/bonds/record/BondGeneralSection.svelte';
	import BondNumbersSection from '$lib/components/bonds/record/BondNumbersSection.svelte';
	import {
		Alert,
		Badge,
		BondStub,
		Button,
		Disclosure,
		Field,
		Money,
		PageHeader,
		Select,
		StatusBadge,
		Table,
		Textarea,
		type TableColumn
	} from '$lib/components/ui';
	import { bondSummary } from '$lib/domain/bond-summary';
	import { calculateFinancialStatus } from '$lib/domain/financial-status';
	import { centsToDecimalString } from '$lib/domain/money';
	import { DRAW_INELIGIBILITY_REASON_LABELS } from '$lib/domain/draw-eligibility';
	import { buenosAiresDateTimeLocal } from '$lib/domain/draws-datetime';
	import { wonPrizeCount as wonCount } from '$lib/domain/prizes';
	import { formatDate, formatMoney } from '$lib/format';
	import type { PageProps } from './$types';

	/**
	 * Bond record (UX plan PR 8, audit A3 and A10). The first screen answers what the bond is, who
	 * has it, who bought it, what is owed and what to do next; the installments and the draws
	 * follow; the history, the reference data and the corrections are collapsed underneath, with the
	 * same actions as before.
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

	const METHOD_ES: Record<string, string> = { cash: 'Efectivo', transfer: 'Transferencia' };
	const ineligibility = (reason: string | null) =>
		reason ? ((DRAW_INELIGIBILITY_REASON_LABELS as Record<string, string>)[reason] ?? reason) : '';
	const collectorOptions = $derived([
		{ value: '', label: 'Elegir…' },
		...data.custody.collectors.map((c) => ({ value: c.id, label: c.displayName }))
	]);

	type Row = Record<string, unknown> & { id: string };
	const paymentColumns: TableColumn<Row>[] = [
		{ key: 'date', header: 'Fecha' },
		{ key: 'amount', header: 'Importe', align: 'right' },
		{ key: 'method', header: 'Medio' },
		{ key: 'status', header: 'Estado' },
		{ key: 'settlement', header: 'Rendición' },
		{ key: 'document', header: 'Comprobante' }
	];
	const prizeColumns: TableColumn<Row>[] = [
		{ key: 'draw', header: 'Sorteo' },
		{ key: 'prize', header: 'Premio' },
		{ key: 'status', header: 'Estado' },
		{ key: 'deliveredAt', header: 'Entregado el' }
	];
	const paymentRows = $derived((data.payments ?? []) as unknown as Row[]);
	const prizeRows = $derived((data.prizes ?? []) as unknown as Row[]);

	// --- The first screen: the stub, the sentence, the next step ----------------------------------
	const baseNumbers = $derived(
		record.numbers
			.filter((n) => n.kind === 'base')
			.map((n) => n.formatted)
			.join(' + ')
	);
	const associatedNumbers = $derived(
		record.numbers
			.filter((n) => n.kind === 'associated')
			.map((n) => n.formatted)
			.join(' + ')
	);
	const summary = $derived(
		bondSummary({
			commercialStatus: general.commercialStatus,
			collectorName: data.parties.collector?.name || null,
			buyerName: data.parties.buyer?.name || null,
			installments: data.installments.map((item) => ({
				number: item.installmentNumber,
				dueDate: item.dueDate,
				amount: item.amount,
				applied: item.applied,
				status: item.status
			})),
			uncollectible: general.financialStatus === 'uncollectible',
			annulledAt: general.annulledAt,
			annulReason: general.annulReason,
			today: data.today
		})
	);
	const partyHref = (ref: 'buyer' | 'collector') =>
		ref === 'buyer'
			? data.parties.buyer?.canOpen
				? resolve('/campaigns/[id]/buyers/[buyerId]', {
						id: campaign.id,
						buyerId: data.parties.buyer.id
					})
				: null
			: data.parties.collector?.canOpen
				? resolve('/campaigns/[id]/collectors/[collectorId]', {
						id: campaign.id,
						collectorId: data.parties.collector.id
					})
				: null;
	/** The one next step that fits the state, when the role may take it. */
	const nextStep = $derived.by(() => {
		if (summary.nextStep === 'deliver' && data.next.deliver)
			return {
				label: 'Entregar a un cobrador',
				href: resolve('/campaigns/[id]/deliveries/new', { id: campaign.id })
			};
		if (summary.nextStep === 'sell' && data.next.sell)
			return {
				label: 'Registrar venta',
				// The sale arrives with this bond already found.
				href: `${resolve('/campaigns/[id]/sales/new', { id: campaign.id })}${
					record.numbers.find((n) => n.kind === 'base')
						? `?bond=${record.numbers.find((n) => n.kind === 'base')!.formatted}`
						: ''
				}`
			};
		if (summary.nextStep === 'pay' && data.next.pay)
			return {
				label: 'Registrar pago',
				href: `${resolve('/campaigns/[id]/settlements/new', { id: campaign.id })}?intent=payment${
					data.parties.collector ? `&collector=${data.parties.collector.id}` : ''
				}`
			};
		return null;
	});
	const phone = $derived(data.parties.buyer?.phone?.trim() || null);
	const pesos = (cents: number) => centsToDecimalString(cents);

	// --- Installments: what is still owed on each ---------------------------------------------------
	const installmentOf = (number: number) =>
		data.installments.find((item) => item.installmentNumber === number);
	const how = (method: string) => (method === 'transfer' ? 'por transferencia' : 'en efectivo');
	/** How an installment with nothing left to pay was paid. */
	const paidLine = (number: number) => {
		const last = installmentOf(number)?.lastPayment;
		if (!last) return 'Pagada';
		return `Pagada el ${formatDate(last.date)} ${how(last.method)}${
			last.settlementNumber ? `, rendición ${last.settlementNumber}` : ''
		}`;
	};
	/**
	 * A payment that is not confirmed yet: the installment still owes it until the settlement closes,
	 * and the record says where that money is.
	 */
	const waitingLine = (number: number) => {
		const item = installmentOf(number);
		const waiting = item?.waitingPayment;
		if (!item || !waiting) return '';
		const amount = formatMoney(item.waiting);
		return waiting.submittedByCollector
			? `Cobro de ${amount} enviado por el cobrador el ${formatDate(waiting.date)}, sin procesar`
			: `Pago de ${amount} ${how(waiting.method)} cargado en la rendición ${waiting.settlementNumber ?? ''}, que sigue abierta`.replace(
					'  ',
					' '
				);
	};
	/**
	 * The financial state from the same installments and payments as the sentence, so the badge
	 * never contradicts it (the stored snapshot only moves when a settlement closes).
	 */
	const financialStatus = $derived(
		data.sale
			? calculateFinancialStatus({
					saleStatus: data.sale.sale.status,
					planStatus: data.sale.plan.status,
					markedUncollectible: general.financialStatus === 'uncollectible',
					today: data.today,
					installments: data.installments.map((item) => ({
						number: item.installmentNumber,
						dueDate: item.dueDate,
						amount: item.amount,
						appliedAmount: item.applied,
						status: item.status
					}))
				})
			: general.financialStatus
	);

	// --- Draws: one line per draw -----------------------------------------------------------------
	type RosterEntry = (typeof data.drawRosterEntries)[number];
	const draws = $derived.by(() => {
		const byDraw: Record<string, { id: string; name: string; entries: RosterEntry[] }> = {};
		for (const entry of data.drawRosterEntries)
			(byDraw[entry.draw.id] ??= {
				id: entry.draw.id,
				name: entry.draw.name,
				entries: []
			}).entries.push(entry);
		return Object.values(byDraw).map((draw) => {
			const blocked = draw.entries.find((entry) => !entry.eligible);
			return {
				...draw,
				numbers: draw.entries
					.map(
						(entry) =>
							`${String(entry.numberValue).padStart(campaign.numberDigits, '0')}${
								entry.numberKind === 'extraordinary' ? ' (extraordinario)' : ''
							}`
					)
					.join(', '),
				eligible: !blocked,
				reason: blocked ? ineligibility(blocked.ineligibilityReason as string | null) : ''
			};
		});
	});

	// Collapsed groups open by themselves when the server answered about something inside them:
	// an error or a result is never hidden.
	const custodyAnswered = $derived(form?.form === 'custody');
	const correctionAnswered = $derived(
		!!form && form.form !== 'custody' && !form.success && !!form.message
	);
	const isGrouped = $derived(
		general.origin === 'manual_grouping' ||
			record.group.memberOf !== null ||
			record.group.pastPatas.length > 0
	);
	const canCorrect = $derived(
		data.custody.can.correctCollector ||
			record.actions.ungroup ||
			record.actions.annul ||
			!!record.actions.lockedMessage
	);
</script>

<svelte:head>
	<title>{title} - {campaign.name} - {institutionName()}</title>
</svelte:head>

<PageHeader
	title={general.typeLabel}
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: campaign.name, href: resolve('/campaigns/[id]', { id: campaign.id }) },
		{ label: 'Bonos', href: resolve('/campaigns/[id]/bonds', { id: campaign.id }) },
		{ label: title }
	]}
/>

<div class="flex max-w-[760px] flex-col gap-8">
	{#if form?.success}
		<Alert tone="success">{form.message}</Alert>
	{:else if form?.message && !formErrors.reason?.length}
		<Alert tone="danger">{form.message}</Alert>
	{/if}

	<section aria-label="Resumen del bono" class="flex flex-col gap-3" data-bond-summary>
		{#if baseNumbers}
			<div>
				<BondStub
					number={baseNumbers}
					caption={baseNumbers.includes('+') ? 'Números base' : 'Número base'}
					detail={associatedNumbers ? `Número asociado ${associatedNumbers}` : undefined}
				/>
			</div>
		{/if}
		<p class="m-0 max-w-[60ch] text-[18px] leading-7 text-text" data-bond-sentence>
			{#each summary.sentences as parts, i (i)}
				{#each parts as part, j (j)}
					{@const href = part.ref ? partyHref(part.ref) : null}
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
		<div class="flex flex-wrap gap-2">
			<StatusBadge kind="bondCommercial" status={general.commercialStatus} />
			{#if general.commercialStatus === 'sold'}
				<StatusBadge kind="bondFinancial" status={financialStatus} />
			{/if}
		</div>
		{#if nextStep || phone}
			<div class="flex flex-wrap gap-2 pt-1">
				{#if nextStep}
					<Button href={nextStep.href} variant="primary" size="lg">{nextStep.label}</Button>
				{/if}
				{#if phone}
					<Button href="tel:{phone.replace(/[^\d+]/g, '')}" size="lg">Llamar al {phone}</Button>
				{/if}
			</div>
		{/if}
	</section>

	{#if data.sale}
		<section aria-labelledby="installments-title" id="installments">
			<div class="flex items-center justify-between gap-3 border-b border-border-strong">
				<h2 id="installments-title" class="m-0 text-heading-3 text-text">Cuotas</h2>
				<a
					class="inline-flex min-h-touch items-center rounded-sm text-body-sm text-primary-text underline underline-offset-2"
					href={resolve('/campaigns/[id]/sales/[saleId]', {
						id: campaign.id,
						saleId: data.sale.sale.id
					})}>Ver la venta</a
				>
			</div>
			<ol class="m-0 list-none p-0" aria-label="Cuotas del bono">
				{#each summary.rows as row (row.number)}
					<li
						class="flex min-h-14 items-center gap-3 border-b border-border py-2"
						data-installment={row.number}
					>
						<span
							class="w-7 shrink-0 font-figure text-[20px] leading-6 font-bold tabular-nums {row.overdue
								? 'text-danger-text'
								: 'text-muted'}"><span class="sr-only">Cuota </span>{row.number}</span
						>
						<span class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-body">
							{#if row.owedCents === 0}
								<span class="text-muted">{paidLine(row.number)}</span>
							{:else}
								<span>{row.overdue ? 'Venció' : 'Vence'} el {formatDate(row.dueDate)}</span>
								{#if row.overdue}<Badge tone="danger">Vencida</Badge>{/if}
								{#if row.owedCents < (Number(row.amount) || 0) * 100}
									<span class="text-body-sm text-muted">pago parcial</span>
								{/if}
								{#if waitingLine(row.number)}
									<span class="basis-full text-body-sm text-muted" data-waiting-payment
										>{waitingLine(row.number)}</span
									>
								{/if}
							{/if}
						</span>
						<Money
							value={pesos(
								row.owedCents === 0 ? Math.round(Number(row.amount) * 100) : row.owedCents
							)}
							class="shrink-0 text-body {row.owedCents === 0 ? 'text-muted' : 'font-medium'}"
						/>
					</li>
				{/each}
			</ol>
			{#if data.canViewPayments === false}
				<p class="m-0 pt-2 text-body-sm text-muted">
					Sin permiso para ver los pagos: una cuota con un pago parcial figura por su importe
					completo.
				</p>
			{/if}
			<p class="m-0 flex items-baseline justify-between gap-3 pt-3">
				<span class="text-body font-semibold">
					{summary.debtCents > 0 ? 'Falta cobrar' : 'Pagado'}
				</span>
				<Money
					value={pesos(
						summary.debtCents > 0
							? summary.debtCents
							: Math.round(Number(data.sale.sale.totalAmount) * 100)
					)}
					class="font-figure text-figure tabular-nums"
				/>
			</p>
		</section>
	{/if}

	{#if data.canViewDraws !== false && (draws.length > 0 || prizeRows.length > 0)}
		<section aria-labelledby="draws-title" id="draws">
			<h2 id="draws-title" class="m-0 border-b border-border-strong pb-2 text-heading-3 text-text">
				Sorteos
			</h2>
			<ul class="m-0 list-none p-0">
				{#each draws as draw (draw.id)}
					<li class="flex items-center justify-between gap-3 border-b border-border py-2.5">
						<span class="min-w-0">
							<a
								class="rounded-sm text-body text-primary-text underline underline-offset-2"
								href={resolve('/campaigns/[id]/draws/[drawId]/roster', {
									id: campaign.id,
									drawId: draw.id
								})}>{draw.name}</a
							>
							<span class="block text-body-sm text-muted">
								Participa con {draw.numbers}{draw.reason ? `. ${draw.reason}` : ''}
							</span>
						</span>
						<Badge tone={draw.eligible ? 'success' : 'warning'}
							>{draw.eligible ? 'Habilitado' : 'No habilitado'}</Badge
						>
					</li>
				{/each}
			</ul>
			{#if data.canViewPrizes !== false && prizeRows.length}
				<div class="mt-4">
					<p class="m-0 mb-2 text-body-sm text-muted">Premios ganados: {wonCount(data.prizes)}</p>
					<Table
						columns={prizeColumns}
						rows={prizeRows}
						caption="Premios del bono"
						density="compact"
					>
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
								N.º {row.position}, {row.name}
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
				</div>
			{/if}
		</section>
	{/if}

	<section aria-labelledby="history-title" class="flex flex-col gap-2">
		<h2 id="history-title" class="m-0 border-b border-border-strong pb-2 text-heading-3 text-text">
			Historial y correcciones
		</h2>

		{#if paymentRows.length}
			<Disclosure summary="Pagos y comprobantes" meta={String(paymentRows.length)}>
				<Table
					columns={paymentColumns}
					rows={paymentRows}
					caption="Pagos del bono"
					density="compact"
				>
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
									href={resolve(`/campaigns/${campaign.id}/payments/${row.id}/print`)}
									>Comprobante</a
								>
							{:else}—{/if}
						{/if}
					{/snippet}
				</Table>
			</Disclosure>
		{/if}

		<Disclosure summary="Entregas y devoluciones" defaultOpen={custodyAnswered}>
			<BondCustodySection
				campaignId={campaign.id}
				fromCollectorId={data.custody.fromCollectorId}
				history={data.custody.history}
				collectors={data.custody.collectors}
				can={data.custody.can}
				form={form?.form === 'custody' ? form : null}
			/>
		</Disclosure>

		<Disclosure summary="Datos del bono" defaultOpen={isGrouped}>
			<div class="flex flex-col gap-6">
				<BondGeneralSection
					campaignId={campaign.id}
					general={{ ...general, financialStatus }}
					group={record.group}
				/>
				<BondNumbersSection campaignId={campaign.id} bondId={general.id} numbers={record.numbers} />
				<BondBarcodeSection barcode={record.barcode} />
			</div>
		</Disclosure>

		{#if record.audit.allowed}
			<Disclosure summary="Movimientos registrados" meta={String(record.audit.entries.length)}>
				<BondAuditSection campaignId={campaign.id} audit={record.audit} />
			</Disclosure>
		{/if}

		{#if canCorrect}
			<Disclosure summary="Corregir o anular" defaultOpen={correctionAnswered}>
				<div class="flex flex-col gap-6">
					{#if data.custody.can.correctCollector}
						<div class="flex flex-col gap-4">
							<h3 class="m-0 text-label text-muted">Corregir el cobrador</h3>
							<Alert tone="warning">
								<strong>Vista previa indicativa:</strong> un bono sin vender solo cambia de custodia.
								Un bono vendido compensa la comisión histórica entre cobradores; las reglas de precedencia
								de la base de datos y los movimientos registrados en la cuenta corriente son los que rigen.
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
									hint="Hasta 1000 caracteres."
								>
									<Textarea name="reason" rows={3} />
								</Field>
								<div><Button type="submit">Confirmar corrección del cobrador</Button></div>
							</form>
						</div>
					{/if}
					<BondActionsSection actions={record.actions} isPata={general.kind === 'pata'} {errors} />
				</div>
			</Disclosure>
		{/if}
	</section>
</div>

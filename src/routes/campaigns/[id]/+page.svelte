<script lang="ts">
	import { institutionName } from '$lib/institution';
	import { resolve } from '$app/paths';
	import RiskyOperationChecklist from '$lib/components/backups/RiskyOperationChecklist.svelte';
	import TransitionAction from '$lib/components/campaigns/TransitionAction.svelte';
	import {
		Alert,
		BondNumber,
		Button,
		Card,
		Money,
		PageHeader,
		StatusBadge
	} from '$lib/components/ui';
	import {
		balanceWords,
		homeTasks,
		wholePesos,
		type HomeTaskTarget
	} from '$lib/domain/campaign-home';
	import { DRAW_TYPE_LABELS, type DrawType } from '$lib/domain/draws';
	import { formatDate, formatDateTime, formatMoney, formatNumber } from '$lib/format';
	import type { PageProps } from './$types';

	/**
	 * Campaign home (UX plan PR 13, audit A7 and A10). In this order: find a bond, the day's actions,
	 * what is waiting for someone («Para resolver», each item leading to where it is resolved), one
	 * line of figures, and the collectors' balances and the next draw as ruled lists. Every amount is
	 * in whole pesos. A draft campaign has «Activar» first; the close checklist stays at the end.
	 */
	let { data, form }: PageProps = $props();

	const campaign = $derived(data.campaign);
	const transitionResult = $derived(form?.form === 'transition' ? form : null);
	const transitionMessage = $derived(
		Object.values(transitionResult?.errors ?? {}).flat()[0] ?? transitionResult?.message
	);
	const missingDates = $derived(!campaign.startsAt || !campaign.endsAt);

	const operationalGroup = $derived(data.dashboard.operational);
	const financialGroup = $derived(data.dashboard.financial);
	const operationalFailed = $derived(operationalGroup !== null && 'error' in operationalGroup);
	const financialFailed = $derived(financialGroup !== null && 'error' in financialGroup);
	const operational = $derived(
		operationalGroup && !('error' in operationalGroup) ? operationalGroup : null
	);
	const financial = $derived(
		financialGroup && !('error' in financialGroup) ? financialGroup : null
	);
	const nextDraw = $derived(operational?.nextDraw ?? null);

	/** Dates and installment plan, under the title (the full rules live in Datos y reglas). */
	const meta = $derived(
		[
			!campaign.startsAt || !campaign.endsAt
				? 'Sin fechas definidas'
				: campaign.status === 'active' || campaign.status === 'closing'
					? // Under way: the start is behind, what matters is when it ends.
						`Hasta el ${formatDate(campaign.endsAt)}`
					: `Del ${formatDate(campaign.startsAt)} al ${formatDate(campaign.endsAt)}`,
			`${campaign.installmentCount} ${campaign.installmentCount === 1 ? 'cuota' : 'cuotas'} de ${formatMoney(campaign.installmentValue)}`
		].join(', ')
	);

	type Link = { label: string; href: string };
	const allowed = (items: [boolean, string, string][]): Link[] =>
		items.filter(([ok]) => ok).map(([, label, href]) => ({ label, href }));
	const id = $derived(campaign.id);

	/** The day's actions: what operations does every day (only while the campaign is active). */
	const dayActions = $derived(
		allowed([
			[data.can.registerSale, 'Registrar venta', resolve('/campaigns/[id]/sales/new', { id })],
			[
				data.can.openSettlement,
				'Registrar pago',
				`${resolve('/campaigns/[id]/settlements/new', { id })}?intent=payment`
			],
			[data.can.deliverBonds, 'Entregar bonos', resolve('/campaigns/[id]/deliveries/new', { id })],
			[data.can.loadBonds, 'Cargar bonos', resolve('/campaigns/[id]/bonds/new', { id })]
		])
	);

	// --- Para resolver --------------------------------------------------------------------------------
	const tasks = $derived(
		homeTasks({
			submitted: operational?.submitted ?? null,
			nextDraw,
			// The count the shell already shows beside «Rendiciones» (the layout's load).
			openSettlements: data.shell?.openSettlements ?? null,
			can: { viewSettlements: data.can.viewSettlements, openSettlement: data.can.openSettlement }
		})
	);
	const hrefOf = (target: HomeTaskTarget | null) =>
		!target || target.kind === 'at-risk-bonds'
			? null
			: target.kind === 'settlement'
				? resolve('/campaigns/[id]/settlements/[settlementId]', {
						id,
						settlementId: target.settlementId
					})
				: target.kind === 'new-settlement'
					? `${resolve('/campaigns/[id]/settlements/new', { id })}?intent=payment&collector=${target.collectorId}`
					: `${resolve('/campaigns/[id]/settlements', { id })}?status=open`;
	const atRisk = $derived(operational?.atRisk ?? []);
	const atRiskTotal = $derived(atRisk[0]?.totalCount ?? atRisk.length);

	// --- Balances and the next draw -------------------------------------------------------------------
	const balances = $derived(
		(financial?.balances.top ?? []).flatMap((row) => {
			const words = balanceWords(row.balance);
			return words ? [{ ...row, ...words }] : [];
		})
	);
	const pendingCommission = $derived(
		financial ? balanceWords(financial.commissions.pending) : null
	);
	const section = 'flex items-baseline justify-between gap-3 border-b border-border-strong pb-2';
	const sectionLink =
		'inline-flex min-h-touch items-center rounded-sm text-body-sm text-primary-text underline underline-offset-2';
	const taskRow = 'flex min-h-14 flex-col gap-x-4 gap-y-1 py-3 sm:flex-row sm:items-center';
	const taskGo = 'shrink-0 text-body-sm font-medium text-primary-text underline underline-offset-2';
</script>

{#snippet taskText(title: string, detail: string)}
	<span class="min-w-0 flex-1">
		<span class="block text-body font-medium text-text">{title}</span>
		<span class="block text-body-sm text-muted">{detail}</span>
	</span>
{/snippet}

{#snippet status()}
	{#if data.can.transitions.length > 0}
		<Card title="Estado" id="status">
			{#if data.can.transitions.includes('closing') || data.can.transitions.includes('closed')}
				<div class="mb-4">
					<RiskyOperationChecklist
						campaignId={campaign.id}
						operation="cerrar la campaña"
						canExport={data.can.exportBackups}
					/>
				</div>
			{/if}
			<div class="flex flex-wrap items-start gap-3">
				{#each data.can.transitions as toStatus (toStatus)}
					<TransitionAction
						{toStatus}
						blockedReason={toStatus === 'active' && missingDates
							? 'Definir las fechas de inicio y de fin antes de activar.'
							: undefined}
					/>
				{/each}
			</div>
		</Card>
	{/if}
{/snippet}

<svelte:head>
	<title>{campaign.name} - Campañas - {institutionName()}</title>
</svelte:head>

<PageHeader
	title={campaign.name}
	description={meta}
	breadcrumbs={[{ label: 'Campañas', href: resolve('/campaigns') }, { label: campaign.name }]}
>
	{#snippet actions()}
		<StatusBadge kind="campaign" status={campaign.status} />
		<Button variant="ghost" size="sm" href={resolve('/campaigns/[id]/configuracion', { id })}
			>Datos y reglas</Button
		>
	{/snippet}
</PageHeader>

<!-- eslint-disable svelte/no-navigation-without-resolve -- every href is resolved in the script -->
<div class="flex flex-col gap-6">
	{#if transitionResult}
		<Alert tone={transitionResult.success ? 'success' : 'danger'}>{transitionMessage}</Alert>
	{/if}

	{#if campaign.status === 'draft'}
		{@render status()}
	{/if}

	{#if data.can.viewBonds}
		<!-- Finding a bond is what happens most. A plain GET to the bonds list. -->
		<form
			method="GET"
			action={resolve('/campaigns/[id]/bonds', { id })}
			class="flex max-w-[720px] flex-col gap-2 sm:flex-row"
			role="search"
			aria-label="Buscar bono"
		>
			<label for="bond-search" class="sr-only">Número de bono</label>
			<input
				id="bond-search"
				name="base"
				inputmode="numeric"
				autocomplete="off"
				placeholder="Número de bono"
				class="h-13 w-full min-w-0 shrink-0 rounded-md border border-border-strong bg-surface px-4 text-[18px] font-medium text-text placeholder:font-normal sm:w-auto sm:flex-1"
			/>
			<!-- On a draft the primary button is «Activar»: one primary per view. -->
			<Button
				type="submit"
				variant={campaign.status === 'draft' ? 'secondary' : 'primary'}
				size="lg">Buscar bono</Button
			>
		</form>
	{/if}

	{#if dayActions.length}
		<!-- The page's primary button is the search; the day's actions are four equal doors. -->
		<ul class="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:flex sm:flex-wrap" data-day-actions>
			{#each dayActions as action (action.href)}
				<li class="flex">
					<Button href={action.href} class="w-full justify-center text-center"
						>{action.label}</Button
					>
				</li>
			{/each}
		</ul>
	{/if}

	{#if operationalFailed}
		<Alert tone="danger"
			>No se pudieron cargar los bonos, lo cobrado y el próximo sorteo. Volver a intentar.</Alert
		>
	{/if}
	{#if financialFailed}
		<Alert tone="danger"
			>No se pudieron cargar los saldos de los cobradores. Volver a intentar.</Alert
		>
	{/if}

	{#if tasks.length > 0}
		<section aria-labelledby="todo-title" id="dash-todo">
			<div class={section}>
				<h2 id="todo-title" class="m-0 text-heading-3 text-text">Para resolver</h2>
			</div>
			<ul class="m-0 list-none p-0">
				{#each tasks as task (task.key)}
					{@const href = hrefOf(task.target)}
					<li class="border-b border-border" data-task={task.key}>
						{#if task.target?.kind === 'at-risk-bonds'}
							<details class="group">
								<summary
									class="{taskRow} cursor-pointer list-none rounded-sm hover:bg-surface-hover [&::-webkit-details-marker]:hidden"
								>
									{@render taskText(task.title, task.detail)}
									<span class={taskGo}>{task.action}</span>
								</summary>
								<ul
									class="m-0 list-none p-0 pb-2"
									aria-label="Bonos que no cubren lo que exige el sorteo"
								>
									{#each atRisk as bond (bond.bondId)}
										<li
											class="flex min-h-touch items-center gap-3 border-t border-border py-1"
											data-at-risk-bond
										>
											{#if bond.baseNumber === null}
												<a
													class="inline-flex min-h-touch items-center rounded-sm text-primary-text underline underline-offset-2"
													href={resolve('/campaigns/[id]/bonds/[bondId]', {
														id,
														bondId: bond.bondId
													})}>Bono sin número</a
												>
											{:else}
												<BondNumber
													number={bond.baseNumber}
													digits={campaign.numberDigits}
													href={resolve('/campaigns/[id]/bonds/[bondId]', {
														id,
														bondId: bond.bondId
													})}
												/>
											{/if}
											<span class="min-w-0 flex-1 text-body-sm text-muted">
												{bond.collectorName ? `Lo cobra ${bond.collectorName}` : 'Sin cobrador'}
											</span>
											<span class="shrink-0 text-body-sm text-text">
												{bond.missingInstallments === 1
													? 'falta 1 cuota'
													: `faltan ${formatNumber(bond.missingInstallments)} cuotas`}
											</span>
										</li>
									{/each}
								</ul>
								{#if atRiskTotal > atRisk.length}
									<p class="m-0 pb-3 text-body-sm text-muted">
										Se muestran {formatNumber(atRisk.length)} de {formatNumber(atRiskTotal)} bonos.
									</p>
								{/if}
							</details>
						{:else if href}
							<a {href} class="{taskRow} rounded-sm hover:bg-surface-hover">
								{@render taskText(task.title, task.detail)}
								<span class={taskGo}>{task.action}</span>
							</a>
						{:else}
							<div class={taskRow}>{@render taskText(task.title, task.detail)}</div>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if operational}
		<section aria-labelledby="state-title">
			<div class={section}>
				<h2 id="state-title" class="m-0 text-heading-3 text-text">Estado de la campaña</h2>
				{#if data.can.viewReports}
					<a class={sectionLink} href={resolve('/campaigns/[id]/reports', { id })}>Reportes</a>
				{/if}
			</div>
			<dl id="dash-figures" class="m-0 grid grid-cols-2 gap-x-6 gap-y-4 pt-4 lg:grid-cols-4">
				<div class="min-w-0">
					<dt class="text-body-sm text-muted">Bonos vendidos</dt>
					<dd class="m-0 font-figure text-figure tabular-nums">
						{formatNumber(operational.bonds.sold)}
					</dd>
					<dd class="m-0 text-body-sm text-muted">de {formatNumber(operational.bonds.total)}</dd>
				</div>
				<div class="min-w-0">
					<dt class="text-body-sm text-muted">En manos de cobradores</dt>
					<dd class="m-0 font-figure text-figure tabular-nums">
						{formatNumber(operational.bonds.delivered)}
					</dd>
					<dd class="m-0 text-body-sm text-muted">
						sin vender{operational.bonds.available > 0
							? `; ${formatNumber(operational.bonds.available)} sin entregar`
							: ''}
					</dd>
				</div>
				<div class="min-w-0">
					<dt class="text-body-sm text-muted">Cobrado</dt>
					<dd class="m-0">
						<Money
							value={wholePesos(operational.revenue.collected)}
							class="font-figure text-figure"
						/>
						<div
							class="mt-1 h-1.5 overflow-hidden rounded-full bg-border"
							role="img"
							aria-label="{operational.revenue.collectedPercent} % de lo vendido"
						>
							<span
								class="block h-full bg-primary"
								style="width: {Math.min(100, operational.revenue.collectedPercent)}%"
							></span>
						</div>
					</dd>
					<dd class="m-0 pt-1 text-body-sm text-muted">
						de <Money value={wholePesos(operational.revenue.expected)} /> vendidos
					</dd>
				</div>
				<div class="min-w-0">
					<dt class="text-body-sm text-muted">Cuotas vencidas sin cobrar</dt>
					<dd class="m-0">
						<Money
							value={wholePesos(operational.revenue.overdue)}
							class="font-figure text-figure"
						/>
					</dd>
					<dd class="m-0 text-body-sm text-muted">
						de <Money value={wholePesos(operational.revenue.pending)} /> por cobrar
					</dd>
				</div>
			</dl>
		</section>
	{/if}

	{#if financial || operational}
		<div class="grid gap-8 lg:grid-cols-2">
			{#if financial}
				<section aria-labelledby="balances-title" id="dash-balances">
					<div class={section}>
						<h2 id="balances-title" class="m-0 text-heading-3 text-text">
							Saldo a favor de cada cobrador
						</h2>
						{#if data.can.viewCollectors}
							<a class={sectionLink} href={resolve('/campaigns/[id]/collectors', { id })}
								>Cobradores</a
							>
						{/if}
					</div>
					{#if balances.length}
						<ul class="m-0 list-none p-0" aria-label="Los saldos más grandes">
							{#each balances as row (row.collectorId)}
								<li class="flex min-h-touch items-center gap-3 border-b border-border">
									<span class="min-w-0 flex-1 text-body">
										{#if data.can.viewCollectors}
											<a
												class="inline-flex min-h-touch items-center rounded-sm text-primary-text underline underline-offset-2"
												href={resolve('/campaigns/[id]/collectors/[collectorId]', {
													id,
													collectorId: row.collectorId
												})}>{row.collectorName}</a
											>
										{:else}
											{row.collectorName}
										{/if}
									</span>
									<span class="shrink-0 text-right">
										<Money value={wholePesos(row.amount)} class="block text-body font-medium" />
										{#if row.owes}
											<span class="block text-body-sm text-muted">a favor de Bomberos</span>
										{/if}
									</span>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="m-0 pt-3 text-body-sm text-muted">Ningún cobrador tiene saldo.</p>
					{/if}
					{#if pendingCommission}
						<p class="m-0 flex items-baseline justify-between gap-3 pt-3">
							<span class="text-body font-semibold"
								>{pendingCommission.owes
									? 'Comisión liquidada de más'
									: 'Comisión sin liquidar'}</span
							>
							<Money value={wholePesos(pendingCommission.amount)} class="text-body font-semibold" />
						</p>
					{/if}
				</section>
			{/if}

			{#if operational}
				<section aria-labelledby="draw-title" id="dash-next-draw">
					<div class={section}>
						<h2 id="draw-title" class="m-0 text-heading-3 text-text">Próximo sorteo</h2>
						{#if data.can.viewDraws}
							<a class={sectionLink} href={resolve('/campaigns/[id]/draws', { id })}>Sorteos</a>
						{/if}
					</div>
					{#if nextDraw}
						<div
							class="relative flex items-center gap-4 border-b border-border py-3 hover:bg-surface-hover"
						>
							<div class="min-w-0 flex-1">
								<p class="m-0 text-body font-medium">
									{#if data.can.viewDraws}
										<a
											class="rounded-sm text-primary-text underline underline-offset-2 after:absolute after:inset-0 after:content-['']"
											href={resolve('/campaigns/[id]/draws/[drawId]', { id, drawId: nextDraw.id })}
											>{nextDraw.name}</a
										>
									{:else}
										{nextDraw.name}
									{/if}
								</p>
								<p class="m-0 text-body-sm text-muted">
									{DRAW_TYPE_LABELS[nextDraw.type as DrawType] ?? 'Sorteo'}, {nextDraw.requiredInstallmentNumber
										? `exige la cuota ${nextDraw.requiredInstallmentNumber} paga`
										: 'exige el pago total'}
								</p>
							</div>
							<div class="shrink-0 text-right">
								<p class="m-0 font-figure text-figure tabular-nums">
									{formatDate(nextDraw.drawDate)}
								</p>
								<p class="m-0 text-body-sm text-muted">
									corte el {formatDateTime(nextDraw.paymentCutoffAt)}
								</p>
							</div>
						</div>
					{:else}
						<p class="m-0 pt-3 text-body-sm text-muted">No hay sorteos programados.</p>
					{/if}
				</section>
			{/if}
		</div>
	{/if}

	{#if campaign.status !== 'draft'}
		{@render status()}
	{/if}
</div>
<!-- eslint-enable svelte/no-navigation-without-resolve -->

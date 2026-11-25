<script lang="ts">
	import { resolve } from '$app/paths';
	import RiskyOperationChecklist from '$lib/components/backups/RiskyOperationChecklist.svelte';
	import TransitionAction from '$lib/components/campaigns/TransitionAction.svelte';
	import {
		Alert,
		Button,
		Card,
		PageHeader,
		StatusBadge,
		Table,
		type TableColumn
	} from '$lib/components/ui';
	import { countdownLabel, cutoffCountdown, type AtRiskBond } from '$lib/domain/dashboard';
	import { DRAW_TYPE_LABELS, type DrawType } from '$lib/domain/draws';
	import { formatSignedMoney } from '$lib/domain/financial-reports';
	import {
		formatDate,
		formatDateTime,
		formatMoney,
		formatNumber,
		formatPaddedNumber
	} from '$lib/format';
	import type { PageProps } from './$types';

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
	const countdown = $derived(nextDraw ? cutoffCountdown(nextDraw.paymentCutoffAt) : null);
	// Once the roster is frozen the cutoff has usually passed: the bonds left are not enabled.
	const rosterFrozen = $derived(nextDraw?.status === 'roster_frozen');
	const atRiskColumns: TableColumn<AtRiskBond & Record<string, unknown>>[] = [
		{ key: 'bond', header: 'Bono' },
		{ key: 'collector', header: 'Cobrador' },
		{ key: 'missing', header: 'Cuotas pendientes', align: 'right' }
	];

	/** Dates and installment plan, under the title (the full rules live in Datos y reglas). */
	const meta = $derived(
		[
			campaign.startsAt && campaign.endsAt
				? `Del ${formatDate(campaign.startsAt)} al ${formatDate(campaign.endsAt)}`
				: 'Sin fechas definidas',
			`${campaign.installmentCount} ${campaign.installmentCount === 1 ? 'cuota' : 'cuotas'} de ${formatMoney(campaign.installmentValue)}`
		].join(', ')
	);

	type Link = { label: string; href: string };
	const allowed = (items: [boolean, string, string][]): Link[] =>
		items.filter(([ok]) => ok).map(([, label, href]) => ({ label, href }));
	const id = $derived(campaign.id);

	/** The day's actions, first: what operations does every day (only while the campaign is active). */
	const dayActions = $derived(
		allowed([
			[data.can.registerSale, 'Registrar venta', resolve('/campaigns/[id]/sales/new', { id })],
			[
				data.can.deliverBonds,
				'Entregar bonos a un cobrador',
				resolve('/campaigns/[id]/deliveries/new', { id })
			],
			[
				data.can.openSettlement,
				'Abrir rendición',
				resolve('/campaigns/[id]/settlements/new', { id })
			],
			[data.can.loadBonds, 'Cargar bonos', resolve('/campaigns/[id]/bonds/new', { id })],
			[data.can.loadBonds, 'Cargar una pata', resolve('/campaigns/[id]/bonds/pata/new', { id })]
		])
	);

	/** Campaign sections, grouped. Administración stays collapsed. */
	const groups = $derived(
		[
			{
				title: 'Operación',
				links: allowed([
					[data.can.viewBonds, 'Bonos', resolve('/campaigns/[id]/bonds', { id })],
					[data.can.viewDeliveries, 'Entregas', resolve('/campaigns/[id]/deliveries', { id })],
					[data.can.viewSales, 'Ventas', resolve('/campaigns/[id]/sales', { id })],
					[data.can.viewSettlements, 'Rendiciones', resolve('/campaigns/[id]/settlements', { id })]
				])
			},
			{
				title: 'Personas',
				links: allowed([
					[data.can.viewCollectors, 'Cobradores', resolve('/campaigns/[id]/collectors', { id })],
					[data.can.viewBuyers, 'Compradores', resolve('/campaigns/[id]/buyers', { id })]
				])
			},
			{
				title: 'Sorteos y reportes',
				links: allowed([
					[data.can.viewDraws, 'Sorteos', resolve('/campaigns/[id]/draws', { id })],
					[data.can.viewReports, 'Reportes', resolve('/campaigns/[id]/reports', { id })]
				])
			}
		].filter((g) => g.links.length)
	);
	const adminLinks = $derived(
		allowed([
			[true, 'Datos y reglas', resolve('/campaigns/[id]/configuracion', { id })],
			[
				data.can.viewCommissions,
				'Reglas de comisión',
				resolve('/campaigns/[id]/commissions', { id })
			],
			[data.can.viewAudit, 'Registro de auditoría', resolve('/campaigns/[id]/audit', { id })],
			[data.can.exportBackups, 'Copias de seguridad', resolve('/campaigns/[id]/backups', { id })]
		])
	);
	const navLink =
		'-ml-2.5 flex min-h-touch items-center rounded-md px-2.5 text-body text-text hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
</script>

{#snippet figure(label: string, value: string, detail?: string)}
	<div>
		<dt class="text-body-sm text-muted">{label}</dt>
		<dd class="m-0 font-figure text-figure tabular-nums">{value}</dd>
		{#if detail}<dd class="m-0 text-body-sm text-muted">{detail}</dd>{/if}
	</div>
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
	<title>{campaign.name} - Campañas - Firefighters</title>
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

	{#if data.can.viewBonds}
		<!-- The hero: finding a bond is what happens most. Plain GET to the bonds list. -->
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
				class="h-13 w-full min-w-0 shrink-0 rounded-md sm:w-auto sm:flex-1 border border-border-strong bg-surface px-4 text-[18px] font-medium text-text placeholder:font-normal"
			/>
			<Button type="submit" variant="primary" size="lg">Buscar bono</Button>
		</form>
	{/if}

	{#if dayActions.length}
		<div class="flex flex-wrap gap-2">
			{#each dayActions as action, i (action.href)}
				<Button href={action.href} variant={i === 0 ? 'primary' : 'secondary'}
					>{action.label}</Button
				>
			{/each}
		</div>
	{/if}

	{#if operational}
		<!-- One line of figures, no nested cards. -->
		<dl
			id="dash-figures"
			class="m-0 grid grid-cols-2 gap-x-8 gap-y-4 border-y border-border py-4 lg:grid-cols-4"
		>
			<div>
				<dt class="text-body-sm text-muted">Bonos vendidos</dt>
				<dd class="m-0 font-figure text-figure tabular-nums">
					{formatNumber(operational.bonds.sold)}<span
						class="ml-1.5 font-sans text-body-sm font-normal text-muted"
						>de {formatNumber(operational.bonds.total)}</span
					>
				</dd>
			</div>
			<div>
				<dt class="text-body-sm text-muted">En manos de cobradores</dt>
				<dd class="m-0 font-figure text-figure tabular-nums">
					{formatNumber(operational.bonds.delivered)}<span
						class="ml-1.5 font-sans text-body-sm font-normal text-muted"
						>{formatNumber(operational.bonds.available)} disponibles</span
					>
				</dd>
			</div>
			<div>
				<dt class="text-body-sm text-muted">Cobrado</dt>
				<dd class="m-0 font-figure text-figure tabular-nums">
					{formatMoney(operational.revenue.collected)}

					<div
						class="mt-2 h-1.5 overflow-hidden rounded-full bg-border"
						role="img"
						aria-label="{operational.revenue.collectedPercent} % de lo esperado ({formatMoney(
							operational.revenue.expected
						)})"
					>
						<span
							class="block h-full bg-primary"
							style="width: {Math.min(100, operational.revenue.collectedPercent)}%"
						></span>
					</div>
				</dd>
			</div>
			<div>
				<dt class="text-body-sm text-muted">Cuotas vencidas</dt>
				<dd class="m-0 font-figure text-figure tabular-nums">
					{formatMoney(operational.revenue.overdue)}<span
						class="ml-1.5 font-sans text-body-sm font-normal text-muted"
						>pendiente {formatMoney(operational.revenue.pending)}</span
					>
				</dd>
			</div>
		</dl>
	{/if}

	{#if operationalFailed}
		<Alert tone="danger"
			>No se pudo cargar el tablero operativo (bonos, recaudación y próximo sorteo). Volver a
			intentar.</Alert
		>
	{/if}
	{#if financialFailed}
		<Alert tone="danger"
			>No se pudo cargar el tablero financiero (efectivo, comisiones y saldos). Volver a intentar.</Alert
		>
	{/if}

	<div class="grid grid-cols-1 gap-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10">
		<div class="flex min-w-0 flex-col gap-5 lg:order-2">
			{#if campaign.status === 'draft'}
				{@render status()}
			{/if}

			{#if operational}
				<Card title="Próximo sorteo" id="dash-next-draw">
					{#if nextDraw && countdown}
						<dl class="m-0 grid grid-cols-1 gap-4 sm:grid-cols-3">
							{@render figure(
								DRAW_TYPE_LABELS[nextDraw.type as DrawType] ?? nextDraw.name,
								formatDate(nextDraw.drawDate),
								nextDraw.name
							)}
							{@render figure(
								'Fecha de corte',
								formatDateTime(nextDraw.paymentCutoffAt),
								countdownLabel(countdown)
							)}
							{@render figure(
								rosterFrozen ? 'Bonos no habilitados' : 'Bonos en riesgo',
								formatNumber(nextDraw.atRiskCount),
								nextDraw.requiredInstallmentNumber
									? `Cuota requerida: ${nextDraw.requiredInstallmentNumber}`
									: 'Requiere el pago total'
							)}
						</dl>
					{:else}
						<p class="m-0 text-body-sm text-muted">No hay sorteos programados.</p>
					{/if}
				</Card>

				{#if nextDraw}
					<Card
						title={rosterFrozen ? 'Bonos no habilitados' : 'Bonos en riesgo'}
						id="dash-at-risk"
						description={rosterFrozen
							? 'Bonos vendidos que no cubrieron las cuotas requeridas antes de la fecha de corte.'
							: 'Bonos vendidos que no cubren las cuotas requeridas antes de la fecha de corte.'}
					>
						{#if operational.atRisk.length}
							<Table
								caption="Bonos en riesgo para {nextDraw.name}"
								columns={atRiskColumns}
								rows={operational.atRisk.map((b) => ({ ...b, id: b.bondId }))}
								rowKey="id"
							>
								{#snippet cell({ row, column })}
									{#if column.key === 'bond'}
										<a
											href={resolve('/campaigns/[id]/bonds/[bondId]', {
												id: campaign.id,
												bondId: row.bondId
											})}
											class="font-figure font-bold text-primary-text tabular-nums underline-offset-2 hover:underline"
											>{row.baseNumber === null
												? 'Sin número'
												: formatPaddedNumber(row.baseNumber, campaign.numberDigits)}</a
										>
									{:else if column.key === 'collector'}
										{row.collectorName ?? 'Sin cobrador'}
									{:else}
										{formatNumber(row.missingInstallments)}
									{/if}
								{/snippet}
							</Table>
							{#if operational.atRisk[0] && operational.atRisk[0].totalCount > operational.atRisk.length}
								<p class="m-0 mt-3 text-body-sm text-muted">
									Se muestran {formatNumber(operational.atRisk.length)} de
									{formatNumber(operational.atRisk[0].totalCount)} bonos en riesgo.
								</p>
							{/if}
						{:else}
							<p class="m-0 text-body-sm text-muted">
								Ningún bono vendido está en riesgo para este sorteo.
							</p>
						{/if}
					</Card>
				{/if}
			{/if}

			{#if financial}
				<Card title="Saldos de cobradores" id="dash-balances">
					<dl class="m-0 grid grid-cols-1 gap-4 sm:grid-cols-2">
						{@render figure('Saldo neto', formatSignedMoney(financial.balances.net))}
						{@render figure(
							'Cobradores con saldo a favor',
							formatNumber(financial.balances.creditors)
						)}
					</dl>
					{#if financial.balances.top.length}
						<table class="mt-4 w-full border-collapse text-body-sm">
							<caption class="sr-only">Saldos más grandes por cobrador</caption>
							<thead>
								<tr class="border-b border-border text-left text-muted">
									<th scope="col" class="py-2 font-medium">Cobrador</th>
									<th scope="col" class="py-2 text-right font-medium">Saldo</th>
								</tr>
							</thead>
							<tbody>
								{#each financial.balances.top as row (row.collectorId)}
									<tr class="border-b border-border last:border-0">
										<td class="py-2.5">{row.collectorName}</td>
										<td class="py-2.5 text-right tabular-nums">{formatSignedMoney(row.balance)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					{:else}
						<p class="m-0 mt-4 text-body-sm text-muted">
							Todavía no hay movimientos en las cuentas corrientes.
						</p>
					{/if}
				</Card>

				<Card title="Efectivo y transferencias" id="dash-cash" description="Pagos confirmados.">
					<dl class="m-0 grid grid-cols-1 gap-4 sm:grid-cols-3">
						{@render figure('Efectivo', formatMoney(financial.cash.cash))}
						{@render figure('Transferencias', formatMoney(financial.cash.transfer))}
						{@render figure('Total cobrado', formatMoney(financial.cash.total))}
					</dl>
					<p class="m-0 mt-4 text-body-sm text-muted">
						Rendido en {formatNumber(financial.commissions.closedSettlements)}
						{financial.commissions.closedSettlements === 1
							? 'rendición cerrada'
							: 'rendiciones cerradas'}:
						{formatMoney(financial.commissions.settledCash)} en efectivo y
						{formatMoney(financial.commissions.settledTransfer)} en transferencias.
						{#if financial.commissions.openSettlements > 0}
							{financial.commissions.openSettlements === 1
								? 'Hay 1 rendición abierta.'
								: `Hay ${formatNumber(financial.commissions.openSettlements)} rendiciones abiertas.`}
						{/if}
					</p>
				</Card>

				<Card title="Comisiones" id="dash-commissions" description="De las rendiciones cerradas.">
					<dl class="m-0 grid grid-cols-1 gap-4 sm:grid-cols-3">
						{@render figure('Generadas', formatMoney(financial.commissions.generated))}
						{@render figure('Liquidadas', formatMoney(financial.commissions.settled))}
						{@render figure('Sin liquidar', formatSignedMoney(financial.commissions.pending))}
					</dl>
				</Card>
			{/if}

			{#if campaign.status !== 'draft'}
				{@render status()}
			{/if}
		</div>
		<nav aria-label="Secciones de la campaña" class="lg:order-1">
			{#each groups as group (group.title)}
				<h2 class="m-0 mt-5 mb-1.5 text-caption text-muted first:mt-0">{group.title}</h2>
				<ul class="m-0 list-none p-0">
					{#each group.links as link (link.href)}
						<li><a href={link.href} class={navLink}>{link.label}</a></li>
					{/each}
				</ul>
			{/each}
			<h2 class="m-0 mt-5 mb-1.5 text-caption text-muted">Administración</h2>
			<details>
				<summary
					class="flex min-h-touch cursor-pointer items-center rounded-sm text-body-sm text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
					>Datos y reglas, comisiones, auditoría y copias</summary
				>
				<ul class="m-0 list-none p-0">
					{#each adminLinks as link (link.href)}
						<li><a href={link.href} class={navLink}>{link.label}</a></li>
					{/each}
				</ul>
			</details>
		</nav>
	</div>
</div>
<!-- eslint-enable svelte/no-navigation-without-resolve -->

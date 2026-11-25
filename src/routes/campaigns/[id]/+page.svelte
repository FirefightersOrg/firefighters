<script lang="ts">
	import { resolve } from '$app/paths';
	import RiskyOperationChecklist from '$lib/components/backups/RiskyOperationChecklist.svelte';
	import CampaignGeneralForm from '$lib/components/campaigns/CampaignGeneralForm.svelte';
	import CampaignRulesForm from '$lib/components/campaigns/CampaignRulesForm.svelte';
	import TransitionAction from '$lib/components/campaigns/TransitionAction.svelte';
	import { campaignEditFormKey } from '$lib/components/campaigns/types';
	import {
		Alert,
		Card,
		PageHeader,
		Stat,
		StatusBadge,
		Table,
		statusMeta,
		type TableColumn
	} from '$lib/components/ui';
	import { countdownLabel, cutoffCountdown, type AtRiskBond } from '$lib/domain/dashboard';
	import { DRAW_TYPE_LABELS, type DrawType } from '$lib/domain/draws';
	import { formatSignedMoney } from '$lib/domain/financial-reports';
	import {
		BARCODE_MODE_LABELS,
		campaignNumberingConfig,
		canEditCampaignRules,
		OVERFLOW_POLICY_LABELS
	} from '$lib/domain/campaigns';
	import { buildNumberingPreview } from '$lib/domain/numbering-preview';
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
	const generalResult = $derived(form?.form === 'general' ? form : null);
	const rulesResult = $derived(form?.form === 'rules' ? form : null);
	const transitionResult = $derived(form?.form === 'transition' ? form : null);
	const transitionMessage = $derived(
		Object.values(transitionResult?.errors ?? {}).flat()[0] ?? transitionResult?.message
	);
	const missingDates = $derived(!campaign.startsAt || !campaign.endsAt);
	const frozenByStatus = $derived(!canEditCampaignRules(campaign.status));
	const rulesFrozen = $derived(frozenByStatus || data.hasBonds);
	const numbering = $derived(buildNumberingPreview(campaignNumberingConfig(campaign)));
	const statusLabel = $derived(statusMeta('campaign', campaign.status).label.toLowerCase());

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

	/** Links to the campaign's other sections, shown only when the person may open them. */
	const sections = $derived(
		[
			[data.can.viewBonds, 'Bonos', resolve('/campaigns/[id]/bonds', { id: campaign.id })],
			[
				data.can.loadBonds,
				'Cargar bonos',
				resolve('/campaigns/[id]/bonds/new', { id: campaign.id })
			],
			[
				data.can.loadBonds,
				'Cargar una pata',
				resolve('/campaigns/[id]/bonds/pata/new', { id: campaign.id })
			],
			[
				data.can.viewCollectors,
				'Cobradores',
				resolve('/campaigns/[id]/collectors', { id: campaign.id })
			],
			[data.can.viewBuyers, 'Compradores', resolve('/campaigns/[id]/buyers', { id: campaign.id })],
			[
				data.can.viewDeliveries,
				'Entregas',
				resolve('/campaigns/[id]/deliveries', { id: campaign.id })
			],
			[data.can.viewSales, 'Ventas', resolve('/campaigns/[id]/sales', { id: campaign.id })],
			[
				data.can.viewSettlements,
				'Rendiciones',
				resolve('/campaigns/[id]/settlements', { id: campaign.id })
			],
			[data.can.viewDraws, 'Sorteos', resolve('/campaigns/[id]/draws', { id: campaign.id })],
			[data.can.viewReports, 'Reportes', resolve('/campaigns/[id]/reports', { id: campaign.id })],
			[
				data.can.exportBackups,
				'Copias de seguridad',
				resolve('/campaigns/[id]/backups', { id: campaign.id })
			],
			[
				data.can.viewCommissions,
				'Reglas de comisión',
				resolve('/campaigns/[id]/commissions', { id: campaign.id })
			],
			[
				data.can.viewAudit,
				'Registro de auditoría',
				resolve('/campaigns/[id]/audit', { id: campaign.id })
			]
		]
			.filter(([allowed]) => allowed)
			.map(([, label, href]) => ({ label: label as string, href: href as string }))
	);
</script>

<svelte:head>
	<title>{campaign.name} - Campañas - Firefighters</title>
</svelte:head>

<PageHeader
	title={campaign.name}
	breadcrumbs={[{ label: 'Campañas', href: resolve('/campaigns') }, { label: campaign.name }]}
>
	{#snippet actions()}
		<StatusBadge kind="campaign" status={campaign.status} />
	{/snippet}
</PageHeader>

<div class="flex flex-col gap-6">
	{#if sections.length}
		<nav aria-label="Secciones de la campaña">
			<ul class="m-0 flex list-none flex-wrap gap-x-6 gap-y-2 p-0 text-label">
				{#each sections as section (section.href)}
					<li>
						<!-- eslint-disable svelte/no-navigation-without-resolve -- hrefs are resolved above -->
						<a
							href={section.href}
							class="rounded-sm text-primary-text underline-offset-2 hover:underline"
							>{section.label}</a
						>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					</li>
				{/each}
			</ul>
		</nav>
	{/if}

	{#if transitionResult}
		<Alert tone={transitionResult.success ? 'success' : 'danger'}>{transitionMessage}</Alert>
	{/if}

	{#if operational || financial || operationalFailed || financialFailed}
		<section aria-labelledby="dashboard-title" class="flex flex-col gap-6">
			<h2 id="dashboard-title" class="m-0 text-heading-2">Tablero</h2>

			{#if operationalFailed}
				<Alert tone="danger"
					>No se pudo cargar el tablero operativo (bonos, recaudación y próximo sorteo). Volver a
					intentar.</Alert
				>
			{/if}
			{#if financialFailed}
				<Alert tone="danger"
					>No se pudo cargar el tablero financiero (efectivo, comisiones y saldos). Volver a
					intentar.</Alert
				>
			{/if}

			{#if operational}
				<Card title="Bonos" id="dash-bonds">
					<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
						<Stat label="Total" value={formatNumber(operational.bonds.total)} />
						<Stat label="Vendidos" value={formatNumber(operational.bonds.sold)} />
						<Stat label="Disponibles" value={formatNumber(operational.bonds.available)} />
						<Stat
							label="Entregados"
							value={formatNumber(operational.bonds.delivered)}
							detail="Con cobrador, sin vender"
						/>
					</div>
				</Card>

				<Card title="Recaudación" id="dash-revenue" description="Cuotas de las ventas activas.">
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
						<Stat label="Esperada" value={formatMoney(operational.revenue.expected)} />
						<Stat
							label="Cobrada"
							value={formatMoney(operational.revenue.collected)}
							detail="{operational.revenue.collectedPercent} % de lo esperado"
						/>
						<Stat
							label="Pendiente"
							value={formatMoney(operational.revenue.pending)}
							detail="Vencido: {formatMoney(operational.revenue.overdue)}"
						/>
					</div>
				</Card>
			{/if}

			{#if financial}
				<Card title="Efectivo y transferencias" id="dash-cash" description="Pagos confirmados.">
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
						<Stat label="Efectivo" value={formatMoney(financial.cash.cash)} />
						<Stat label="Transferencias" value={formatMoney(financial.cash.transfer)} />
						<Stat label="Total cobrado" value={formatMoney(financial.cash.total)} />
					</div>
					<p class="m-0 mt-4 text-body-sm text-muted">
						Rendido en {formatNumber(financial.commissions.closedSettlements)} rendiciones cerradas:
						{formatMoney(financial.commissions.settledCash)} en efectivo y
						{formatMoney(financial.commissions.settledTransfer)} en transferencias.
						{#if financial.commissions.openSettlements > 0}
							Hay {formatNumber(financial.commissions.openSettlements)} rendiciones abiertas.
						{/if}
					</p>
				</Card>

				<Card title="Comisiones" id="dash-commissions" description="De las rendiciones cerradas.">
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
						<Stat label="Generadas" value={formatMoney(financial.commissions.generated)} />
						<Stat label="Liquidadas" value={formatMoney(financial.commissions.settled)} />
						<Stat label="Sin liquidar" value={formatSignedMoney(financial.commissions.pending)} />
					</div>
				</Card>

				<Card title="Saldos de cobradores" id="dash-balances">
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<Stat label="Saldo neto" value={formatSignedMoney(financial.balances.net)} />
						<Stat
							label="Cobradores con saldo a favor"
							value={formatNumber(financial.balances.creditors)}
						/>
					</div>
					{#if financial.balances.top.length}
						<ul class="m-0 mt-4 list-none space-y-1 p-0 text-body-sm">
							{#each financial.balances.top as row (row.collectorId)}
								<li class="flex justify-between gap-4">
									<span>{row.collectorName}</span>
									<span class="tabular-nums">{formatSignedMoney(row.balance)}</span>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="m-0 mt-4 text-body-sm text-muted">
							Todavía no hay movimientos en las cuentas corrientes.
						</p>
					{/if}
				</Card>
			{/if}

			{#if operational}
				<Card title="Próximo sorteo" id="dash-next-draw">
					{#if nextDraw && countdown}
						<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
							<Stat
								label={DRAW_TYPE_LABELS[nextDraw.type as DrawType] ?? nextDraw.name}
								value={formatDate(nextDraw.drawDate)}
								detail={nextDraw.name}
							/>
							<Stat
								label="Fecha de corte"
								value={formatDateTime(nextDraw.paymentCutoffAt)}
								detail={countdownLabel(countdown)}
							/>
							<Stat
								label={rosterFrozen ? 'Bonos no habilitados' : 'Bonos en riesgo'}
								value={formatNumber(nextDraw.atRiskCount)}
								detail={nextDraw.requiredInstallmentNumber
									? `Cuota requerida: ${nextDraw.requiredInstallmentNumber}`
									: 'Requiere el pago total'}
							/>
						</div>
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
											class="font-mono text-primary-text underline-offset-2 hover:underline"
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
		</section>
	{/if}

	<Card title="Resumen" id="summary">
		<dl class="m-0 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
			<div>
				<dt class="text-caption text-muted">Fecha de inicio</dt>
				<dd class="m-0 mt-0.5">{formatDate(campaign.startsAt)}</dd>
			</div>
			<div>
				<dt class="text-caption text-muted">Fecha de fin</dt>
				<dd class="m-0 mt-0.5">{formatDate(campaign.endsAt)}</dd>
			</div>
			<div>
				<dt class="text-caption text-muted">Modo de código de barras</dt>
				<dd class="m-0 mt-0.5">{BARCODE_MODE_LABELS[campaign.barcodeMode]}</dd>
			</div>
			{#if campaign.barcodePattern}
				<div>
					<dt class="text-caption text-muted">Patrón del código de barras</dt>
					<dd class="m-0 mt-0.5 font-mono break-all">{campaign.barcodePattern}</dd>
				</div>
			{/if}
			<div>
				<dt class="text-caption text-muted">Valor del bono simple</dt>
				<dd class="m-0 mt-0.5 tabular-nums">{formatMoney(campaign.simpleBondValue)}</dd>
			</div>
			<div>
				<dt class="text-caption text-muted">Cuotas</dt>
				<dd class="m-0 mt-0.5 tabular-nums">
					{campaign.installmentCount} × {formatMoney(campaign.installmentValue)}
				</dd>
			</div>
			<div>
				<dt class="text-caption text-muted">Política de desborde</dt>
				<dd class="m-0 mt-0.5">
					{OVERFLOW_POLICY_LABELS[campaign.overflowPolicy] ?? campaign.overflowPolicy}
				</dd>
			</div>
			<div>
				<dt class="text-caption text-muted">Cantidad de dígitos</dt>
				<dd class="m-0 mt-0.5 tabular-nums">{campaign.numberDigits}</dd>
			</div>
			<div>
				<dt class="text-caption text-muted">Número máximo</dt>
				<dd class="m-0 mt-0.5 tabular-nums">{campaign.maxNumber}</dd>
			</div>
			<div>
				<dt class="text-caption text-muted">Desfase del número asociado</dt>
				<dd class="m-0 mt-0.5 tabular-nums">+{campaign.associatedNumberOffset}</dd>
			</div>
			{#if numbering.ok}
				<div class="sm:col-span-2">
					<dt class="text-caption text-muted">Números base utilizables</dt>
					<dd class="m-0 mt-0.5 tabular-nums">
						<span class="font-mono"
							>{numbering.examples[0].baseFormatted}–{numbering.maxValidBase.baseFormatted}</span
						>
						({formatNumber(numbering.usableBaseCount)}); el mayor da el número asociado
						<span class="font-mono">{numbering.maxValidBase.associatedFormatted}</span>
					</dd>
				</div>
			{/if}
		</dl>
		{#if rulesFrozen}
			<div class="mt-4">
				<Alert tone="warning">
					{#if frozenByStatus}
						<strong>Las reglas están congeladas.</strong> Esta campaña está {statusLabel} y las reglas
						(precio, cuotas, numeración, política de desborde y modo de código de barras) solo se pueden
						cambiar mientras la campaña es un borrador. Se muestran arriba en solo lectura.
					{:else}
						<strong>Las reglas están congeladas.</strong> Esta campaña ya tiene bonos y sus números y
						valores dependen de las reglas (precio, cuotas, numeración, política de desborde y modo de
						código de barras), por lo que ya no se pueden cambiar, aunque la campaña siga siendo un borrador.
						Se muestran arriba en solo lectura.
					{/if}
				</Alert>
			</div>
		{:else if !data.can.editRules}
			<p class="m-0 mt-4 text-body-sm text-muted">
				Las reglas se pueden cambiar mientras la campaña es un borrador, por quienes tienen permiso
				para modificarlas.
			</p>
		{/if}
	</Card>

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

	<!-- The forms keep their own input state, taken with the version it belongs to: re-mount them
	     whenever a load brings another campaign or a new version (e.g. after a status change). -->
	{#key campaignEditFormKey(campaign)}
		{#if data.can.editName || data.can.editDates}
			<CampaignGeneralForm
				{campaign}
				result={generalResult}
				nameReadonly={!data.can.editName}
				datesReadonly={!data.can.editDates}
			/>
		{/if}

		{#if data.can.editRules}
			<RiskyOperationChecklist
				campaignId={campaign.id}
				operation="cambiar las reglas de la campaña"
				canExport={data.can.exportBackups}
			/>
			<CampaignRulesForm {campaign} result={rulesResult} />
		{/if}
	{/key}
</div>

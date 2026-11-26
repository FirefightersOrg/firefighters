<script lang="ts">
	import { institutionName } from '$lib/institution';
	import { resolve } from '$app/paths';
	import RiskyOperationChecklist from '$lib/components/backups/RiskyOperationChecklist.svelte';
	import CampaignGeneralForm from '$lib/components/campaigns/CampaignGeneralForm.svelte';
	import CampaignRulesForm from '$lib/components/campaigns/CampaignRulesForm.svelte';
	import { campaignEditFormKey } from '$lib/components/campaigns/types';
	import { Alert, Card, PageHeader, StatusBadge, statusMeta } from '$lib/components/ui';
	import {
		ASSOCIATED_NUMBER_MODE_LABELS,
		BARCODE_MODE_LABELS,
		campaignNumberingConfig,
		canEditCampaignRules,
		OVERFLOW_POLICY_LABELS
	} from '$lib/domain/campaigns';
	import { buildNumberingPreview } from '$lib/domain/numbering-preview';
	import { formatDate, formatMoney, formatNumber } from '$lib/format';
	// Same load and actions as the campaign page (re-exported), so it shares that page's data types.
	import type { ActionData, PageData } from '../$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const campaign = $derived(data.campaign);
	const generalResult = $derived(form?.form === 'general' ? form : null);
	const rulesResult = $derived(form?.form === 'rules' ? form : null);
	const frozenByStatus = $derived(!canEditCampaignRules(campaign.status));
	const rulesFrozen = $derived(frozenByStatus || data.hasBonds);
	const numbering = $derived(buildNumberingPreview(campaignNumberingConfig(campaign)));
	const statusLabel = $derived(statusMeta('campaign', campaign.status).label.toLowerCase());
</script>

<svelte:head>
	<title>Datos y reglas - {campaign.name} - {institutionName()}</title>
</svelte:head>

<PageHeader
	title="Datos y reglas"
	description="Fechas, precio, cuotas, numeración y código de barras de la campaña."
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: campaign.name, href: resolve('/campaigns/[id]', { id: campaign.id }) },
		{ label: 'Datos y reglas' }
	]}
>
	{#snippet actions()}
		<StatusBadge kind="campaign" status={campaign.status} />
	{/snippet}
</PageHeader>

<div class="flex flex-col gap-6">
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
				<dt class="text-caption text-muted">Modo del número asociado</dt>
				<dd class="m-0 mt-0.5">{ASSOCIATED_NUMBER_MODE_LABELS[campaign.associatedNumberMode]}</dd>
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

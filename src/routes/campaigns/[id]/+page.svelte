<script lang="ts">
	import { statusWord } from '$lib/domain/status-word';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import { resolve } from '$app/paths';
	import RiskyOperationChecklist from '$lib/components/backups/RiskyOperationChecklist.svelte';
	import CampaignGeneralForm from '$lib/components/campaigns/CampaignGeneralForm.svelte';
	import CampaignRulesForm from '$lib/components/campaigns/CampaignRulesForm.svelte';
	import FormAlert from '$lib/components/campaigns/FormAlert.svelte';
	import TransitionAction from '$lib/components/campaigns/TransitionAction.svelte';
	import { cardClass } from '$lib/components/campaigns/styles';
	import { campaignEditFormKey } from '$lib/components/campaigns/types';
	import {
		BARCODE_MODE_LABELS,
		campaignNumberingConfig,
		canEditCampaignRules,
		formatCampaignDate
	} from '$lib/domain/campaigns';
	import { formatInteger, formatMoney } from '$lib/domain/money';
	import { buildNumberingPreview } from '$lib/domain/numbering-preview';
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
</script>

<svelte:head>
	<title>{campaign.name} - Campaigns - Firefighters</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<a href={resolve('/campaigns')} class="text-sm text-blue-700 hover:underline">← Campaigns</a>
		<div class="mt-2 flex flex-wrap items-center gap-3">
			<h1 class="text-2xl font-bold tracking-tight">{campaign.name}</h1>
			<StatusBadge kind="campaign" status={campaign.status} />
		</div>
		{#if data.can.viewCommissions || data.can.viewAudit || data.can.loadBonds || data.can.viewBonds || data.can.viewCollectors || data.can.viewBuyers || data.can.viewDeliveries || data.can.viewSales || data.can.viewSettlements || data.can.viewDraws || data.can.exportBackups}
			<nav aria-label="Campaign sections" class="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
				{#if data.can.viewBonds}
					<a
						href={resolve('/campaigns/[id]/bonds', { id: campaign.id })}
						class="font-medium text-blue-700 hover:underline">Bonds →</a
					>
				{/if}
				{#if data.can.loadBonds}
					<a
						href={resolve('/campaigns/[id]/bonds/new', { id: campaign.id })}
						class="font-medium text-blue-700 hover:underline">Load bonds →</a
					>
					<a
						href={resolve('/campaigns/[id]/bonds/pata/new', { id: campaign.id })}
						class="font-medium text-blue-700 hover:underline">Load a pata →</a
					>
				{/if}
				{#if data.can.viewCollectors}
					<a
						href={resolve('/campaigns/[id]/collectors', { id: campaign.id })}
						class="font-medium text-blue-700 hover:underline">Collectors →</a
					>
				{/if}
				{#if data.can.viewBuyers}
					<a
						href={resolve('/campaigns/[id]/buyers', { id: campaign.id })}
						class="font-medium text-blue-700 hover:underline">Buyers →</a
					>
				{/if}
				{#if data.can.viewDeliveries}
					<a
						href={resolve('/campaigns/[id]/deliveries', { id: campaign.id })}
						class="font-medium text-blue-700 hover:underline">Deliveries →</a
					>
				{/if}
				{#if data.can.viewSales}
					<a
						href={resolve('/campaigns/[id]/sales', { id: campaign.id })}
						class="font-medium text-blue-700 hover:underline">Sales →</a
					>
				{/if}
				{#if data.can.viewSettlements}
					<a
						href={resolve('/campaigns/[id]/settlements', { id: campaign.id })}
						class="font-medium text-blue-700 hover:underline">Settlements →</a
					>
				{/if}
				{#if data.can.viewDraws}
					<a
						href={resolve('/campaigns/[id]/draws', { id: campaign.id })}
						class="font-medium text-blue-700 hover:underline">Draws →</a
					>
				{/if}
				{#if data.can.exportBackups}
					<a
						href={resolve('/campaigns/[id]/backups', { id: campaign.id })}
						class="font-medium text-blue-700 hover:underline">Backup exports →</a
					>
				{/if}
				{#if data.can.viewCommissions}
					<a
						href={resolve('/campaigns/[id]/commissions', { id: campaign.id })}
						class="font-medium text-blue-700 hover:underline">Commission rules →</a
					>
				{/if}
				{#if data.can.viewAudit}
					<a
						href={resolve('/campaigns/[id]/audit', { id: campaign.id })}
						class="font-medium text-blue-700 hover:underline">Audit log →</a
					>
				{/if}
			</nav>
		{/if}
	</div>

	{#if transitionResult}
		<FormAlert kind={transitionResult.success ? 'success' : 'error'} message={transitionMessage} />
	{/if}

	<section class={cardClass} aria-labelledby="summary-title">
		<h2 id="summary-title" class="mb-4 text-base font-semibold">Summary</h2>
		<dl class="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
			<div>
				<dt class="text-xs font-medium text-slate-500">Start date</dt>
				<dd class="mt-0.5">{formatCampaignDate(campaign.startsAt)}</dd>
			</div>
			<div>
				<dt class="text-xs font-medium text-slate-500">End date</dt>
				<dd class="mt-0.5">{formatCampaignDate(campaign.endsAt)}</dd>
			</div>
			<div>
				<dt class="text-xs font-medium text-slate-500">Barcode mode</dt>
				<dd class="mt-0.5">{BARCODE_MODE_LABELS[campaign.barcodeMode]}</dd>
			</div>
			{#if campaign.barcodePattern}
				<div>
					<dt class="text-xs font-medium text-slate-500">Barcode pattern</dt>
					<dd class="mt-0.5 font-mono break-all">{campaign.barcodePattern}</dd>
				</div>
			{/if}
			<div>
				<dt class="text-xs font-medium text-slate-500">Simple bond value</dt>
				<dd class="mt-0.5 tabular-nums">{formatMoney(campaign.simpleBondValue)}</dd>
			</div>
			<div>
				<dt class="text-xs font-medium text-slate-500">Installments</dt>
				<dd class="mt-0.5 tabular-nums">
					{campaign.installmentCount} × {formatMoney(campaign.installmentValue)}
				</dd>
			</div>
			<div>
				<dt class="text-xs font-medium text-slate-500">Overflow policy</dt>
				<dd class="mt-0.5">{campaign.overflowPolicy}</dd>
			</div>
			<div>
				<dt class="text-xs font-medium text-slate-500">Number of digits</dt>
				<dd class="mt-0.5 tabular-nums">{campaign.numberDigits}</dd>
			</div>
			<div>
				<dt class="text-xs font-medium text-slate-500">Maximum number</dt>
				<dd class="mt-0.5 tabular-nums">{campaign.maxNumber}</dd>
			</div>
			<div>
				<dt class="text-xs font-medium text-slate-500">Associated number offset</dt>
				<dd class="mt-0.5 tabular-nums">+{campaign.associatedNumberOffset}</dd>
			</div>
			{#if numbering.ok}
				<div class="sm:col-span-2">
					<dt class="text-xs font-medium text-slate-500">Usable base numbers</dt>
					<dd class="mt-0.5 tabular-nums">
						<span class="font-mono"
							>{numbering.examples[0].baseFormatted}–{numbering.maxValidBase.baseFormatted}</span
						>
						({formatInteger(numbering.usableBaseCount)}); the highest gives associated number
						<span class="font-mono">{numbering.maxValidBase.associatedFormatted}</span>
					</dd>
				</div>
			{/if}
		</dl>
		{#if rulesFrozen}
			<div class="mt-4">
				<FormAlert kind="warning">
					{#if frozenByStatus}
						<p>
							<strong>Rules are frozen.</strong> This campaign is {statusWord(campaign.status)}, and
							rules (price, installments, numbering, overflow policy and barcode mode) can only be
							changed while a campaign is a draft. They are shown read-only above.
						</p>
					{:else}
						<p>
							<strong>Rules are frozen.</strong> This campaign already has bonds, and their numbers and
							values depend on the rules (price, installments, numbering, overflow policy and barcode
							mode), so they can no longer be changed, even though the campaign is still a draft. They
							are shown read-only above.
						</p>
					{/if}
				</FormAlert>
			</div>
		{:else if !data.can.editRules}
			<p class="mt-4 text-xs text-slate-500">
				Rules can be changed while the campaign is a draft, by users allowed to change rules.
			</p>
		{/if}
	</section>

	{#if data.can.transitions.length > 0}
		<section class={cardClass} aria-labelledby="status-title">
			<h2 id="status-title" class="mb-4 text-base font-semibold">Status</h2>
			{#if data.can.transitions.includes('closing') || data.can.transitions.includes('closed')}
				<div class="mb-4">
					<RiskyOperationChecklist
						campaignId={campaign.id}
						operation="closing the campaign"
						canExport={data.can.exportBackups}
					/>
				</div>
			{/if}
			<div class="flex flex-wrap items-start gap-3">
				{#each data.can.transitions as toStatus (toStatus)}
					<TransitionAction
						{toStatus}
						blockedReason={toStatus === 'active' && missingDates
							? 'Set the start and end dates before activating.'
							: undefined}
					/>
				{/each}
			</div>
		</section>
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
				operation="changing the campaign rules"
				canExport={data.can.exportBackups}
			/>
			<CampaignRulesForm {campaign} result={rulesResult} />
		{/if}
	{/key}
</div>

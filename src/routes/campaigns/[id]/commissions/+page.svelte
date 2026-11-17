<script lang="ts">
	import { resolve } from '$app/paths';
	import CampaignStatusBadge from '$lib/components/campaigns/CampaignStatusBadge.svelte';
	import FormAlert from '$lib/components/campaigns/FormAlert.svelte';
	import { cardClass } from '$lib/components/campaigns/styles';
	import AnnulRuleAction from '$lib/components/commissions/AnnulRuleAction.svelte';
	import CommissionRuleForm from '$lib/components/commissions/CommissionRuleForm.svelte';
	import { CAMPAIGN_STATUS_LABELS } from '$lib/domain/campaigns';
	import {
		commissionRuleTiming,
		formatCommissionRuleType,
		formatCommissionValue,
		formatValidity,
		type CommissionRuleTiming
	} from '$lib/domain/commissions';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const campaign = $derived(data.campaign);
	const listHref = $derived(resolve('/campaigns/[id]/commissions', { id: campaign.id }));

	// Edit mode: `?edit=<id>`, or a failed edit submitted without JavaScript (the action URL drops
	// the `edit` parameter, so the failed result says which rule was being edited).
	const editRuleId = $derived(
		form?.form === 'update' && !form.success && form.ruleId ? form.ruleId : data.editRuleId
	);
	const editRule = $derived(
		data.can.manage && editRuleId
			? (data.rules.find((r) => r.id === editRuleId && r.status === 'active') ?? null)
			: null
	);
	const ruleFormResult = $derived(
		form && (form.form === 'create' || form.form === 'update') ? form : null
	);
	// The create/edit form only shows results that belong to it: a failed edit stays in the edit
	// form; a successful edit is shown on the create form (edit mode was left).
	const formResult = $derived.by(() => {
		if (!ruleFormResult) return null;
		if (editRule) {
			return ruleFormResult.form === 'update' &&
				!ruleFormResult.success &&
				ruleFormResult.ruleId === editRule.id
				? ruleFormResult
				: null;
		}
		return ruleFormResult.form === 'create' || ruleFormResult.success ? ruleFormResult : null;
	});
	const annulResult = $derived(form?.form === 'annul' ? form : null);
	const annulMessage = $derived(
		Object.values(annulResult?.errors ?? {}).flat()[0] ?? annulResult?.message
	);

	const TIMING_LABELS: Record<CommissionRuleTiming, { label: string; tone: string }> = {
		current: { label: 'In effect', tone: 'bg-green-50 text-green-800 ring-green-600/20' },
		upcoming: { label: 'Upcoming', tone: 'bg-blue-50 text-blue-800 ring-blue-600/20' },
		ended: { label: 'Ended', tone: 'bg-slate-100 text-slate-700 ring-slate-500/20' }
	};
</script>

<svelte:head>
	<title>Commission rules - {campaign.name} - Firefighters</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<a
			href={resolve('/campaigns/[id]', { id: campaign.id })}
			class="text-sm text-blue-700 hover:underline">← {campaign.name}</a
		>
		<div class="mt-2 flex flex-wrap items-center gap-3">
			<h1 class="text-2xl font-bold tracking-tight">Commission rules</h1>
			<CampaignStatusBadge status={campaign.status} />
		</div>
		<p class="mt-1 text-sm text-slate-600">
			General rules apply to every collector of this campaign. Special collector rules come later.
		</p>
	</div>

	{#if annulResult}
		<FormAlert kind={annulResult.success ? 'success' : 'error'} message={annulMessage} />
	{/if}
	{#if data.editNotFound}
		<FormAlert
			kind="warning"
			message="That rule cannot be edited: it does not exist in this campaign or was annulled."
		/>
	{/if}
	{#if campaign.status !== 'draft' && campaign.status !== 'active'}
		<FormAlert kind="warning">
			<p>
				<strong>Read-only.</strong> This campaign is {CAMPAIGN_STATUS_LABELS[
					campaign.status
				].toLowerCase()}; commission rules can only be changed while a campaign is a draft or
				active.
			</p>
		</FormAlert>
	{/if}

	<section class={cardClass} aria-labelledby="rules-title">
		<h2 id="rules-title" class="mb-4 text-base font-semibold">General rules</h2>
		{#if data.rules.length === 0}
			<p class="text-sm text-slate-600">No commission rules yet.</p>
		{:else}
			<div class="-mx-6 overflow-x-auto">
				<table class="min-w-full divide-y divide-slate-200 text-sm">
					<thead>
						<tr class="text-left text-xs font-medium text-slate-500">
							<th scope="col" class="px-6 py-2">Type</th>
							<th scope="col" class="px-3 py-2 text-right">Commission</th>
							<th scope="col" class="px-3 py-2">Validity</th>
							<th scope="col" class="px-3 py-2">Status</th>
							{#if data.can.manage}
								<th scope="col" class="px-6 py-2"><span class="sr-only">Actions</span></th>
							{/if}
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each data.rules as rule (rule.id)}
							{@const annulled = rule.status === 'annulled'}
							{@const timing = TIMING_LABELS[commissionRuleTiming(rule, data.today)]}
							<tr
								id="rule-{rule.id}"
								class={[annulled && 'text-slate-500', rule.id === editRule?.id && 'bg-blue-50']}
							>
								<td class="px-6 py-3 font-medium">{formatCommissionRuleType(rule)}</td>
								<td class="px-3 py-3 text-right whitespace-nowrap tabular-nums">
									<span class={[annulled && 'line-through']}>{formatCommissionValue(rule)}</span>
								</td>
								<td class="px-3 py-3 whitespace-nowrap">{formatValidity(rule)}</td>
								<td class="px-3 py-3">
									{#if annulled}
										<span
											class="inline-flex rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-800 ring-1 ring-red-600/20 ring-inset"
											>Annulled</span
										>
										{#if rule.annulReason}
											<p class="mt-1 max-w-xs text-xs break-words">{rule.annulReason}</p>
										{/if}
									{:else}
										<span
											class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset {timing.tone}"
											>{timing.label}</span
										>
									{/if}
								</td>
								{#if data.can.manage}
									<td class="px-6 py-3 text-right whitespace-nowrap">
										{#if !annulled}
											<div class="flex justify-end gap-4">
												<a
													href="{listHref}?edit={rule.id}#edit-rule-title"
													class="text-sm font-medium text-blue-700 hover:underline"
													aria-label="Edit rule: {formatCommissionRuleType(rule)}, {formatValidity(
														rule
													)}">Edit</a
												>
												<AnnulRuleAction
													ruleId={rule.id}
													description="{formatCommissionRuleType(rule)}, {formatCommissionValue(
														rule
													)}, {formatValidity(rule)}"
												/>
											</div>
										{/if}
									</td>
								{/if}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>

	{#if data.can.manage}
		<!-- Re-mount when switching between create and edit, between rules, or when a load brings a
		     new version of the edited rule: its values and version must come from the same load. -->
		{#key editRule ? `${editRule.id}@${editRule.updatedAt}` : 'new'}
			<CommissionRuleForm
				rule={editRule}
				installmentCount={campaign.installmentCount}
				result={formResult}
				campaignId={campaign.id}
			/>
		{/key}
	{:else if campaign.status === 'draft' || campaign.status === 'active'}
		<p class="text-xs text-slate-500">
			Only users allowed to manage commission rules can change them.
		</p>
	{/if}
</div>

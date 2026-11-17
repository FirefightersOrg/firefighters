<script lang="ts">
	import { resolve } from '$app/paths';
	import CampaignStatusBadge from '$lib/components/campaigns/CampaignStatusBadge.svelte';
	import { cardClass, primaryButtonClass } from '$lib/components/campaigns/styles';
	import { formatCampaignDate } from '$lib/domain/campaigns';
	import { formatMoney } from '$lib/domain/money';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Campaigns - Firefighters</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex flex-wrap items-center justify-between gap-4">
		<div>
			<h1 class="text-2xl font-bold tracking-tight">Campaigns</h1>
			<p class="text-sm text-slate-500">Bond campaigns, newest first.</p>
		</div>
		{#if data.canCreate}
			<a href={resolve('/campaigns/new')} class={primaryButtonClass}>New campaign</a>
		{/if}
	</div>

	{#if data.campaigns.length === 0}
		<div class="{cardClass} text-center text-sm text-slate-500">
			No campaigns yet.
			{#if data.canCreate}Create the first one with “New campaign”.{/if}
		</div>
	{:else}
		<div class="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
			<table class="min-w-full divide-y divide-slate-200 text-sm">
				<thead
					class="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500"
				>
					<tr>
						<th scope="col" class="px-4 py-3">Name</th>
						<th scope="col" class="px-4 py-3">Status</th>
						<th scope="col" class="px-4 py-3">Dates</th>
						<th scope="col" class="px-4 py-3 text-right">Bond value</th>
						<th scope="col" class="px-4 py-3 text-right">Installments</th>
						<th scope="col" class="px-4 py-3 text-right">Digits</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each data.campaigns as campaign (campaign.id)}
						<tr class="hover:bg-slate-50">
							<td class="px-4 py-3 font-medium">
								<a
									href={resolve('/campaigns/[id]', { id: campaign.id })}
									class="text-blue-700 hover:underline"
								>
									{campaign.name}
								</a>
							</td>
							<td class="px-4 py-3"><CampaignStatusBadge status={campaign.status} /></td>
							<td class="whitespace-nowrap px-4 py-3 text-slate-600">
								{formatCampaignDate(campaign.startsAt)} – {formatCampaignDate(campaign.endsAt)}
							</td>
							<td class="whitespace-nowrap px-4 py-3 text-right tabular-nums">
								{formatMoney(campaign.simpleBondValue)}
							</td>
							<td class="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-600">
								{campaign.installmentCount} × {formatMoney(campaign.installmentValue)}
							</td>
							<td class="px-4 py-3 text-right tabular-nums">{campaign.numberDigits}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

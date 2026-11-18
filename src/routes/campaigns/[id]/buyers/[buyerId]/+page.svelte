<script lang="ts">
	import { resolve } from '$app/paths';
	import BuyerForm from '$lib/components/buyers/BuyerForm.svelte';
	import FormAlert from '$lib/components/campaigns/FormAlert.svelte';
	import { cardClass } from '$lib/components/campaigns/styles';
	import { buyerDisplayName, buyerIdentification, BUYER_TYPE_LABELS } from '$lib/domain/parties';
	import { formatCampaignNumber } from '$lib/domain/numbering';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	const baseNumbers = (bond: { baseNumbers: number[]; campaignNumberDigits: number }) =>
		bond.baseNumbers
			.map((number) =>
				formatCampaignNumber(number, {
					numberDigits: bond.campaignNumberDigits,
					maxNumber: 10 ** bond.campaignNumberDigits - 1,
					associatedNumberOffset: 0,
					overflowPolicy: 'reject'
				})
			)
			.join(', ');
</script>

<svelte:head
	><title>{buyerDisplayName(data.buyer)} - {data.campaign.name} - Firefighters</title></svelte:head
>
<div class="space-y-6">
	<nav class="text-sm">
		<a class="text-blue-700 underline" href={resolve('/campaigns/[id]', { id: data.campaign.id })}
			>← {data.campaign.name}</a
		>
		/
		<a
			class="text-blue-700 underline"
			href={resolve('/campaigns/[id]/buyers', {
				id: data.campaign.id
			})}>Buyers</a
		>
	</nav>
	<h1 class="text-2xl font-bold">{buyerDisplayName(data.buyer)}</h1>
	{#if form?.message}<FormAlert
			kind={form.success ? 'success' : 'error'}
			message={form.message}
		/>{/if}
	<section class={cardClass}>
		<h2 class="mb-4 text-lg font-semibold">General data</h2>
		{#if data.canManage}<BuyerForm
				campaignId={data.campaign.id}
				buyer={data.buyer}
				collectors={data.collectors}
				usualCollectorNotVisible={data.usualCollectorNotVisible}
				canViewCollectors={data.canViewCollectors}
				{form}
			/>{:else}<dl class="grid gap-3 sm:grid-cols-2">
				<div>
					<dt class="text-slate-500">Type</dt>
					<dd>{BUYER_TYPE_LABELS[data.buyer.type]}</dd>
				</div>
				<div>
					<dt class="text-slate-500">Name</dt>
					<dd>{buyerDisplayName(data.buyer)}</dd>
				</div>
				<div>
					<dt class="text-slate-500">Identification</dt>
					<dd>{buyerIdentification(data.buyer) ?? '—'}</dd>
				</div>
				<div>
					<dt class="text-slate-500">Phone</dt>
					<dd>{data.buyer.phone ?? '—'}</dd>
				</div>
				<div>
					<dt class="text-slate-500">Usual collector</dt>
					<dd>{data.collector?.displayName ?? '—'}</dd>
				</div>
				<div>
					<dt class="text-slate-500">Address</dt>
					<dd>{data.buyer.address ?? '—'}</dd>
				</div>
				<div>
					<dt class="text-slate-500">Notes</dt>
					<dd class="whitespace-pre-wrap">{data.buyer.notes ?? '—'}</dd>
				</div>
			</dl>{/if}
	</section>
	<section class={cardClass}>
		<h2 class="text-lg font-semibold">Purchased bonds in this campaign</h2>
		<ul class="mt-2 text-sm">
			{#each data.campaignBonds as bond (bond.id)}<li class="border-t py-2">
					<a
						class="text-blue-700 underline"
						href={resolve('/campaigns/[id]/bonds/[bondId]', {
							id: data.campaign.id,
							bondId: bond.id
						})}>{baseNumbers(bond) || 'No base number'}</a
					>
				</li>{:else}<li class="text-slate-500">No bonds purchased in this campaign.</li>{/each}
		</ul>
	</section>
	<section class={cardClass}>
		<h2 class="text-lg font-semibold">Installments and debt</h2>
		<p class="mt-2 text-sm text-slate-500">Arrives with Phase 7/8: sales and installments.</p>
	</section>
	<section class={cardClass}>
		<h2 class="text-lg font-semibold">Prizes</h2>
		<p class="mt-2 text-sm text-slate-500">Arrives with Phase 12: prizes.</p>
	</section>
	<section class={cardClass}>
		<h2 class="text-lg font-semibold">Historical numbers</h2>
		<ul class="mt-2 text-sm">
			{#each data.historicalBonds as bond (bond.id)}<li class="border-t py-2">
					{bond.campaignName}:
					<a
						class="text-blue-700 underline"
						href={resolve('/campaigns/[id]/bonds/[bondId]', {
							id: bond.campaignId,
							bondId: bond.id
						})}>{baseNumbers(bond) || 'No base number'}</a
					>
				</li>{:else}<li class="text-slate-500">No historical numbers.</li>{/each}
		</ul>
	</section>
	<section class={cardClass}>
		<h2 class="text-lg font-semibold">Audit</h2>
		{#if data.audit}<ul class="mt-2 text-sm">
				{#each data.audit.entries as entry (entry.id)}<li class="border-t py-2">
						{entry.action} — {entry.actorName ?? 'Unknown'} — {entry.createdAt}
					</li>{:else}<li class="text-slate-500">No audit entries.</li>{/each}
			</ul>{:else}<p class="mt-2 text-sm text-slate-500">
				You do not have permission to view audit history.
			</p>{/if}
	</section>
</div>

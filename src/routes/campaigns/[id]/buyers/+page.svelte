<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve */
	import { resolve } from '$app/paths';
	import { buyerDisplayName, buyerIdentification, BUYER_TYPE_LABELS } from '$lib/domain/parties';
	import { cardClass, inputClass, primaryButtonClass } from '$lib/components/campaigns/styles';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	const href = $derived(resolve('/campaigns/[id]/buyers', { id: data.campaign.id }));
	const collectorHref = (collectorId: string) =>
		`/campaigns/${data.campaign.id}/collectors/${collectorId}`;
	const collector = (id: string | null) => data.collectors.find((c) => c.id === id);
</script>

<svelte:head><title>Buyers - {data.campaign.name} - Firefighters</title></svelte:head>
<div class="space-y-6">
	<div>
		<a
			class="text-sm text-blue-700 underline"
			href={resolve('/campaigns/[id]', { id: data.campaign.id })}>← {data.campaign.name}</a
		>
		<h1 class="mt-2 text-2xl font-bold">Buyers</h1>
	</div>
	{#if data.can.manage}<a
			class={primaryButtonClass}
			href={resolve('/campaigns/[id]/buyers/new', { id: data.campaign.id })}>New buyer</a
		>{/if}
	<form method="GET" action={href} class={cardClass}>
		<div class="flex gap-3">
			<input class={inputClass} name="q" value={data.query.q} placeholder="Search buyers" /><select
				class={inputClass}
				name="type"
				><option value="">Any type</option><option
					value="individual"
					selected={data.query.type === 'individual'}>Individual</option
				><option value="business" selected={data.query.type === 'business'}>Business</option
				></select
			><button class={primaryButtonClass}>Search</button>
		</div>
	</form>
	{#if data.buyers.length === 0}<div class="{cardClass} text-slate-500">
			No buyers match these filters.
		</div>{:else}<div class="overflow-x-auto rounded border bg-white">
			<table class="min-w-full text-sm">
				<thead
					><tr
						><th>Name</th><th>Type</th><th>Identification</th><th>Phone</th><th>Usual collector</th
						></tr
					></thead
				><tbody
					>{#each data.buyers as buyer (buyer.id)}<tr class="border-t"
							><td
								><a
									class="text-blue-700 underline"
									href={resolve('/campaigns/[id]/buyers/[buyerId]', {
										id: data.campaign.id,
										buyerId: buyer.id
									})}>{buyerDisplayName(buyer)}</a
								></td
							><td>{BUYER_TYPE_LABELS[buyer.type]}</td><td>{buyerIdentification(buyer) ?? '—'}</td
							><td>{buyer.phone ?? '—'}</td><td
								>{#if collector(buyer.usualCollectorId)}<a
										class="text-blue-700 underline"
										href={collectorHref(collector(buyer.usualCollectorId)!.id)}
										>{collector(buyer.usualCollectorId)!.displayName}</a
									>{:else}—{/if}</td
							></tr
						>{/each}</tbody
				>
			</table>
		</div>{/if}
	{#if data.pagination.pageCount > 1}<nav class="flex justify-between text-sm">
			<span>Page {data.pagination.page} of {data.pagination.pageCount}</span
			>{#if data.pagination.page < data.pagination.pageCount}<a
					class="text-blue-700 underline"
					href={`${href}?page=${data.pagination.page + 1}`}>Next →</a
				>{/if}
		</nav>{/if}
</div>

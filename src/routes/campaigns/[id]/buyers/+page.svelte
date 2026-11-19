<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import { buyerDisplayName, buyerIdentification, BUYER_TYPE_LABELS } from '$lib/domain/parties';
	import { cardClass, inputClass, primaryButtonClass } from '$lib/components/campaigns/styles';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	const href = $derived(resolve('/campaigns/[id]/buyers', { id: data.campaign.id }));
	function pageLink(page: number): ResolvedPathname {
		const pairs = Object.entries(data.query).filter(([, value]) => value);
		if (page > 1) pairs.push(['page', String(page)]);
		const search = pairs.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
		return (search ? `${href}?${search}` : href) as ResolvedPathname;
	}
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
								>{collector(buyer.usualCollectorId)?.displayName ?? '—'}</td
							></tr
						>{/each}</tbody
				>
			</table>
		</div>{/if}
	{#if data.pagination.pageCount > 1}<nav class="flex justify-between text-sm">
			{#if data.pagination.page > 1}<a
					class="text-blue-700 underline"
					href={pageLink(data.pagination.page - 1)}>← Previous</a
				>{:else}<span></span>{/if}
			<span>Page {data.pagination.page} of {data.pagination.pageCount}</span
			>{#if data.pagination.page < data.pagination.pageCount}<a
					class="text-blue-700 underline"
					href={pageLink(data.pagination.page + 1)}>Next →</a
				>{:else}<span></span>{/if}
		</nav>{/if}
</div>

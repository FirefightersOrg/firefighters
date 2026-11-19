<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import {
		cardClass,
		inputClass,
		labelClass,
		primaryButtonClass,
		secondaryButtonClass
	} from '$lib/components/campaigns/styles';
	import { PAYMENT_MODE_LABELS } from '$lib/domain/sales';
	import { formatMoney } from '$lib/domain/money';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	const href = $derived(resolve('/campaigns/[id]/sales', { id: data.campaign.id }));
	function pageLink(page: number): ResolvedPathname {
		const pairs = Object.entries(data.filters).filter(([, value]) => value);
		if (page > 1) pairs.push(['page', String(page)]);
		const search = pairs.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
		return (search ? `${href}?${search}` : href) as ResolvedPathname;
	}
</script>

<svelte:head><title>Sales - {data.campaign.name}</title></svelte:head>
<div class="space-y-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<a
				class="text-sm text-blue-700 hover:underline"
				href={resolve('/campaigns/[id]', { id: data.campaign.id })}>← {data.campaign.name}</a
			>
			<h1 class="mt-2 text-2xl font-bold">Sales</h1>
		</div>
		{#if data.can.create}<a
				class={primaryButtonClass}
				href={resolve('/campaigns/[id]/sales/new', { id: data.campaign.id })}>Register sale</a
			>{/if}
	</div>
	<form method="GET" class="{cardClass} grid gap-3 sm:grid-cols-5 sm:items-end">
		<div>
			<label class={labelClass} for="collector">Collector</label><select
				class={inputClass}
				id="collector"
				name="collector"
				><option value="">All</option>{#each data.collectors as collector (collector.id)}<option
						value={collector.id}
						selected={data.filters.collector === collector.id}>{collector.displayName}</option
					>{/each}</select
			>
		</div>
		<div>
			<label class={labelClass} for="buyer">Buyer</label><input
				class={inputClass}
				id="buyer"
				name="buyer"
				value={data.filters.buyer}
			/>
		</div>
		<div>
			<label class={labelClass} for="paymentMode">Mode</label><select
				class={inputClass}
				id="paymentMode"
				name="paymentMode"
				><option value="">All</option
				>{#each Object.entries(PAYMENT_MODE_LABELS) as [key, label] (key)}<option
						value={key}
						selected={data.filters.paymentMode === key}>{label}</option
					>{/each}</select
			>
		</div>
		<div>
			<label class={labelClass} for="financialStatus">Financial status</label><select
				class={inputClass}
				id="financialStatus"
				name="financialStatus"
				><option value="">All</option><option value="no_payments">No payments</option><option
					value="overdue">Overdue</option
				><option value="partial_payments">Partial payments</option><option value="up_to_date"
					>Up to date</option
				></select
			>
		</div>
		<div class="flex gap-2">
			<button class={primaryButtonClass}>Filter</button><a class={secondaryButtonClass} {href}
				>Clear</a
			>
		</div>
	</form>
	<section class={cardClass}>
		<table class="min-w-full text-sm">
			<thead class="text-left text-xs uppercase text-slate-500"
				><tr
					><th class="py-2 pr-3">Bond</th><th class="py-2 pr-3">Buyer</th><th class="py-2 pr-3"
						>Collector</th
					><th class="py-2 pr-3">Mode</th><th class="py-2 pr-3">Total</th><th class="py-2"
						>Financial</th
					></tr
				></thead
			><tbody class="divide-y divide-slate-100"
				>{#each data.sales as item (item.sale.id)}<tr
						><td class="py-2 pr-3"
							><a
								class="text-blue-700 hover:underline"
								href={resolve('/campaigns/[id]/sales/[saleId]', {
									id: data.campaign.id,
									saleId: item.sale.id
								})}>{item.bondNumbers.join(', ')}</a
							></td
						><td>{item.buyerName}</td><td>{item.collectorName}</td><td
							>{PAYMENT_MODE_LABELS[item.sale.paymentMode]}</td
						><td>{formatMoney(item.sale.totalAmount)}</td><td
							>{item.financialStatus.replaceAll('_', ' ')}</td
						></tr
					>{:else}<tr><td colspan="6" class="py-3 text-slate-500">No sales match.</td></tr
					>{/each}</tbody
			>
		</table>
		{#if data.pagination.pageCount > 1}<nav class="mt-4 flex justify-between text-sm">
				<span>Page {data.pagination.page} of {data.pagination.pageCount}</span><span
					class="flex gap-2"
					>{#if data.pagination.page > 1}<a
							class={secondaryButtonClass}
							href={pageLink(data.pagination.page - 1)}>← Previous</a
						>{/if}{#if data.pagination.page < data.pagination.pageCount}<a
							class={secondaryButtonClass}
							href={pageLink(data.pagination.page + 1)}>Next →</a
						>{/if}</span
				>
			</nav>{/if}
	</section>
</div>

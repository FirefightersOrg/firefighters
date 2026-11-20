<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		cardClass,
		inputClass,
		labelClass,
		primaryButtonClass,
		secondaryButtonClass
	} from '$lib/components/campaigns/styles';
	import { formatMoney } from '$lib/domain/money';
	import { formatCampaignDate } from '$lib/domain/campaigns';
	import { SETTLEMENT_STATUS_LABELS, SETTLEMENT_STATUSES } from '$lib/domain/payments';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
</script>

<svelte:head><title>Settlements - {data.campaign.name}</title></svelte:head>
<div class="space-y-6">
	<div class="flex items-center justify-between">
		<div>
			<a
				class="text-sm text-blue-700 hover:underline"
				href={resolve('/campaigns/[id]', { id: data.campaign.id })}>← {data.campaign.name}</a
			>
			<h1 class="mt-2 text-2xl font-bold">Settlements</h1>
		</div>
		{#if data.can.create}<a
				class={primaryButtonClass}
				href={resolve('/campaigns/[id]/settlements/new', { id: data.campaign.id })}
				>Open settlement</a
			>{/if}
	</div>
	<form method="GET" class="{cardClass} grid gap-3 sm:grid-cols-5 sm:items-end">
		<div>
			<label class={labelClass} for="collector">Collector</label><select
				class={inputClass}
				id="collector"
				name="collector"
				><option value="">All</option>{#each data.collectors as c (c.id)}<option
						value={c.id}
						selected={data.filters.collector === c.id}>{c.displayName}</option
					>{/each}</select
			>
		</div>
		<div>
			<label class={labelClass} for="status">Status</label><select
				class={inputClass}
				id="status"
				name="status"
				><option value="">All</option>{#each SETTLEMENT_STATUSES as s (s)}<option
						value={s}
						selected={data.filters.status === s}>{SETTLEMENT_STATUS_LABELS[s]}</option
					>{/each}</select
			>
		</div>
		<div>
			<label class={labelClass} for="from">From</label><input
				class={inputClass}
				id="from"
				type="date"
				name="from"
				value={data.filters.from}
			/>
		</div>
		<div>
			<label class={labelClass} for="to">To</label><input
				class={inputClass}
				id="to"
				type="date"
				name="to"
				value={data.filters.to}
			/>
		</div>
		<div class="flex gap-2">
			<button class={primaryButtonClass}>Filter</button><a
				class={secondaryButtonClass}
				href={resolve('/campaigns/[id]/settlements', { id: data.campaign.id })}>Clear</a
			>
		</div>
	</form>
	<section class={cardClass}>
		<table class="min-w-full text-sm">
			<thead class="text-left text-xs uppercase text-slate-500"
				><tr
					><th class="py-2 pr-3">Number</th><th class="py-2 pr-3">Collector</th><th
						class="py-2 pr-3">Status</th
					><th class="py-2 pr-3">Total</th><th class="py-2">Opened</th></tr
				></thead
			><tbody class="divide-y divide-slate-100"
				>{#each data.settlements as s (s.id)}<tr
						><td class="py-2 pr-3"
							><a
								class="text-blue-700 hover:underline"
								href={resolve('/campaigns/[id]/settlements/[settlementId]', {
									id: data.campaign.id,
									settlementId: s.id
								})}>#{s.settlementNumber}</a
							></td
						><td>{s.collectorName}</td><td>{SETTLEMENT_STATUS_LABELS[s.status]}</td><td
							>{formatMoney(s.totals.totalAmount)}</td
						><td>{formatCampaignDate(s.openedAt)}</td></tr
					>{:else}<tr><td colspan="5" class="py-3 text-slate-500">No settlements match.</td></tr
					>{/each}</tbody
			>
		</table>
	</section>
</div>

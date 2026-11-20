<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		cardClass,
		inputClass,
		labelClass,
		primaryButtonClass,
		secondaryButtonClass
	} from '$lib/components/campaigns/styles';
	import {
		DRAW_STATUSES,
		DRAW_STATUS_LABELS,
		DRAW_TYPES,
		DRAW_TYPE_LABELS
	} from '$lib/domain/draws';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
</script>

<svelte:head><title>Draws - {data.campaign.name}</title></svelte:head>
<div class="space-y-6">
	<header class="flex items-center justify-between">
		<div>
			<a
				class="text-sm text-blue-700 hover:underline"
				href={resolve('/campaigns/[id]', { id: data.campaign.id })}>← {data.campaign.name}</a
			>
			<h1 class="mt-2 text-2xl font-bold">Draws</h1>
		</div>
		{#if data.can.create}<a
				class={primaryButtonClass}
				href={resolve('/campaigns/[id]/draws/new', { id: data.campaign.id })}>New draw</a
			>{/if}
	</header>
	<form method="GET" class="{cardClass} grid gap-3 sm:grid-cols-3 sm:items-end">
		<div>
			<label class={labelClass} for="type">Type</label><select
				class={inputClass}
				id="type"
				name="type"
				><option value="">All</option>{#each DRAW_TYPES as type (type)}<option
						value={type}
						selected={data.filters.type === type}>{DRAW_TYPE_LABELS[type]}</option
					>{/each}</select
			>
		</div>
		<div>
			<label class={labelClass} for="status">Status</label><select
				class={inputClass}
				id="status"
				name="status"
				><option value="">All</option>{#each DRAW_STATUSES as status (status)}<option
						value={status}
						selected={data.filters.status === status}>{DRAW_STATUS_LABELS[status]}</option
					>{/each}</select
			>
		</div>
		<div class="flex gap-2">
			<button class={primaryButtonClass}>Filter</button><a
				class={secondaryButtonClass}
				href={resolve('/campaigns/[id]/draws', { id: data.campaign.id })}>Clear</a
			>
		</div>
	</form>
	<section class={cardClass}>
		<table class="min-w-full text-sm">
			<thead
				><tr class="text-left"><th>Name</th><th>Type</th><th>Date</th><th>Status</th></tr></thead
			><tbody>
				{#each data.draws as draw (draw.id)}<tr class="border-t border-slate-100"
						><td class="py-2"
							><a
								class="text-blue-700 underline"
								href={resolve('/campaigns/[id]/draws/[drawId]', {
									id: data.campaign.id,
									drawId: draw.id
								})}>{draw.name}</a
							></td
						><td>{DRAW_TYPE_LABELS[draw.drawType]}</td><td>{draw.drawDate}</td><td
							>{DRAW_STATUS_LABELS[draw.status]}</td
						></tr
					>
				{:else}<tr><td class="py-3 text-slate-500" colspan="4">No draws match.</td></tr>{/each}
			</tbody>
		</table>
	</section>
</div>

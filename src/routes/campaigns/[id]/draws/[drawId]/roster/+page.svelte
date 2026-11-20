<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		cardClass,
		inputClass,
		labelClass,
		primaryButtonClass,
		secondaryButtonClass
	} from '$lib/components/campaigns/styles';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
</script>

<svelte:head><title>Roster - {data.draw.name}</title></svelte:head>
<div class="space-y-6">
	<header>
		<a
			class="text-sm text-blue-700 underline"
			href={resolve('/campaigns/[id]/draws/[drawId]', {
				id: data.campaign.id,
				drawId: data.draw.id
			})}>← {data.draw.name}</a
		>
		<h1 class="mt-2 text-2xl font-bold">
			{data.roster.status === 'frozen' ? 'Frozen roster' : 'Current generated roster'}
		</h1>
		<p class="text-sm text-slate-600">{data.pagination.total} matching numbers</p>
	</header>
	<form method="GET" class="{cardClass} grid gap-3 sm:grid-cols-3 sm:items-end">
		<div>
			<label class={labelClass} for="q">Number, bond, buyer or collector</label><input
				class={inputClass}
				id="q"
				name="q"
				value={data.filters.q}
			/>
		</div>
		<div>
			<label class={labelClass} for="eligibility">Eligibility</label><select
				class={inputClass}
				id="eligibility"
				name="eligibility"
				><option value="">All</option><option
					value="eligible"
					selected={data.filters.eligibility === 'eligible'}>Eligible</option
				><option value="ineligible" selected={data.filters.eligibility === 'ineligible'}
					>Not eligible</option
				></select
			>
		</div>
		<div><button class={primaryButtonClass}>Search</button></div>
	</form>
	<section class={cardClass}>
		<table class="min-w-full text-sm">
			<thead
				><tr class="text-left"
					><th>Number</th><th>Bond</th><th>Buyer</th><th>Collector</th><th>Eligibility</th></tr
				></thead
			><tbody
				>{#each data.entries as entry (entry.id)}<tr
						class:font-semibold={entry.numberKind === 'extraordinary'}
						class="border-t border-slate-100"
						><td class="py-2 font-mono"
							>{entry.formattedNumber}{#if entry.numberKind === 'extraordinary'}
								<span class="rounded bg-violet-100 px-1 text-xs text-violet-800">extraordinary</span
								>{/if}</td
						><td>{entry.bondLabel}</td><td>{entry.buyerName}</td><td>{entry.collectorName}</td><td
							>{entry.eligible ? 'Eligible' : `Not eligible — ${entry.reasonLabel}`}</td
						></tr
					>{:else}<tr><td colspan="5" class="py-3 text-slate-500">No roster entries match.</td></tr
					>{/each}</tbody
			>
		</table>
	</section>
	{#if data.pagination.pages > 1}<nav
			aria-label="Roster pages"
			class="flex items-center justify-between text-sm"
		>
			<span>Page {data.pagination.page} of {data.pagination.pages}</span>
			<div class="flex gap-2">
				{#if data.pagination.page > 1}<form method="GET">
						<input type="hidden" name="q" value={data.filters.q} />
						<input type="hidden" name="eligibility" value={data.filters.eligibility} />
						<input type="hidden" name="page" value={data.pagination.page - 1} />
						<button class={secondaryButtonClass}>Previous</button>
					</form>{/if}{#if data.pagination.page < data.pagination.pages}<form method="GET">
						<input type="hidden" name="q" value={data.filters.q} />
						<input type="hidden" name="eligibility" value={data.filters.eligibility} />
						<input type="hidden" name="page" value={data.pagination.page + 1} />
						<button class={secondaryButtonClass}>Next</button>
					</form>{/if}
			</div>
		</nav>{/if}
</div>

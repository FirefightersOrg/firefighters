<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import RiskyOperationChecklist from '$lib/components/backups/RiskyOperationChecklist.svelte';
	import { cardClass, inputClass, secondaryButtonClass } from '$lib/components/campaigns/styles';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const campaign = $derived(data.campaign);
	let from = $state('');
	let to = $state('');
	const href = (kind: string, hasPeriod: boolean) => {
		const base = `/campaigns/${campaign.id}/backups/export/${kind}`;
		const q = [
			hasPeriod && from ? `from=${encodeURIComponent(from)}` : '',
			hasPeriod && to ? `to=${encodeURIComponent(to)}` : ''
		].filter(Boolean);
		return (q.length ? `${base}?${q.join('&')}` : base) as ResolvedPathname;
	};
</script>

<svelte:head><title>Backup exports - {campaign.name} - Firefighters</title></svelte:head>

<div class="space-y-6">
	<div>
		<a
			href={resolve('/campaigns/[id]', { id: campaign.id })}
			class="text-sm text-blue-700 hover:underline">← {campaign.name}</a
		>
		<h1 class="mt-2 text-2xl font-bold tracking-tight">Backup exports</h1>
		<p class="mt-1 text-sm text-slate-600">
			CSV files generated on demand from the current data. Run them before any risky operation.
		</p>
	</div>

	<RiskyOperationChecklist
		campaignId={campaign.id}
		operation="a risky operation (bulk import, rule change, bulk correction, closure)"
		canExport={true}
	/>

	<section class={cardClass} aria-labelledby="period-title">
		<h2 id="period-title" class="mb-2 text-base font-semibold">Period (optional)</h2>
		<p class="mb-3 text-xs text-slate-500">
			Filters payments (payment date) and collector accounts (entry date), inclusive.
		</p>
		<div class="flex flex-wrap gap-3 text-sm">
			<label>From <input type="date" bind:value={from} class={inputClass} /></label>
			<label>To <input type="date" bind:value={to} class={inputClass} /></label>
		</div>
	</section>

	<section class={cardClass} aria-labelledby="exports-title">
		<h2 id="exports-title" class="mb-3 text-base font-semibold">Exports</h2>
		<ul class="space-y-2 text-sm">
			{#each data.exports as e (e.kind)}
				<li class="flex items-center justify-between gap-3">
					<span>{e.label}</span>
					{#if e.allowed}
						<a href={href(e.kind, e.hasPeriod)} download class={secondaryButtonClass}
							>Download CSV</a
						>
					{:else}
						<span class="text-xs text-slate-500">Not allowed for your role</span>
					{/if}
				</li>
			{/each}
			{#each data.pending as p (p)}
				<li class="flex items-center justify-between gap-3 text-slate-500">
					<span>{p === 'frozen-rosters' ? 'Frozen rosters' : 'Winners and prizes'}</span>
					<span class="text-xs">Pending (Phase 11/12)</span>
				</li>
			{/each}
		</ul>
	</section>
</div>

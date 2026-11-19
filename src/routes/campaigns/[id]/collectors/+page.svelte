<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		cardClass,
		inputClass,
		labelClass,
		primaryButtonClass,
		secondaryButtonClass
	} from '$lib/components/campaigns/styles';
	import { COLLECTOR_STATUSES, COLLECTOR_STATUS_LABELS } from '$lib/domain/parties';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	const listHref = $derived(resolve('/campaigns/[id]/collectors', { id: data.campaign.id }));
	const link = (page: number) => {
		const pairs = [
			data.query.q ? `q=${encodeURIComponent(data.query.q)}` : '',
			data.query.status ? `status=${data.query.status}` : '',
			page > 1 ? `page=${page}` : ''
		].filter(Boolean);
		return `${resolve('/campaigns/[id]/collectors', { id: data.campaign.id })}?${pairs.join('&')}`;
	};
</script>

<svelte:head><title>Collectors - {data.campaign.name} - Firefighters</title></svelte:head>
<div class="space-y-6">
	<div>
		<a
			href={resolve('/campaigns/[id]', { id: data.campaign.id })}
			class="text-sm text-blue-700 hover:underline">← {data.campaign.name}</a
		>
		<h1 class="mt-2 text-2xl font-bold tracking-tight">Collectors</h1>
	</div>
	{#if data.can.manage}<a
			href={resolve('/campaigns/[id]/collectors/new', { id: data.campaign.id })}
			class={primaryButtonClass}>New collector</a
		>{/if}
	<form method="GET" action={listHref} class="{cardClass} grid gap-4 sm:grid-cols-3">
		<div>
			<label for="q" class={labelClass}>Search</label><input
				id="q"
				name="q"
				value={data.query.q}
				class={inputClass}
				placeholder="Name, phone or email"
			/>
		</div>
		<div>
			<label for="status" class={labelClass}>Status</label><select
				id="status"
				name="status"
				class={inputClass}
				><option value="">Any</option>{#each COLLECTOR_STATUSES as status (status)}<option
						value={status}
						selected={data.query.status === status}>{COLLECTOR_STATUS_LABELS[status]}</option
					>{/each}</select
			>
		</div>
		<div class="self-end flex gap-2">
			<button class={primaryButtonClass}>Apply filters</button><a
				href={listHref}
				class={secondaryButtonClass}>Clear</a
			>
		</div>
	</form>
	{#if data.pagination.total === 0}<div class="{cardClass} text-center text-sm text-slate-500">
			No collectors match these filters.
		</div>
	{:else}<div class="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
			<table class="min-w-full divide-y divide-slate-200 text-sm">
				<thead class="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500"
					><tr
						><th class="px-4 py-3">Name</th><th class="px-4 py-3">Phone</th><th class="px-4 py-3"
							>Email</th
						><th class="px-4 py-3">Status</th><th class="px-4 py-3">Linked user</th><th
							class="px-4 py-3 text-right">Assigned bonds in this campaign</th
						></tr
					></thead
				><tbody class="divide-y divide-slate-100"
					>{#each data.collectors as collector (collector.id)}<tr
							><td class="px-4 py-3 font-medium"
								><a
									href={resolve('/campaigns/[id]/collectors/[collectorId]', {
										id: data.campaign.id,
										collectorId: collector.id
									})}
									class="text-blue-700 hover:underline">{collector.displayName}</a
								></td
							><td class="px-4 py-3">{collector.phone ?? '—'}</td><td class="px-4 py-3"
								>{collector.email ?? '—'}</td
							><td class="px-4 py-3">{COLLECTOR_STATUS_LABELS[collector.status]}</td><td
								class="px-4 py-3">{collector.userProfileId ? 'Yes' : 'No'}</td
							><td class="px-4 py-3 text-right">{collector.assignedBonds}</td></tr
						>{/each}</tbody
				>
			</table>
		</div>
		{#if data.pagination.pageCount > 1}<nav class="flex justify-between text-sm">
				{#if data.pagination.page > 1}<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- filtered page link is built from the resolved list path --><a
						href={link(data.pagination.page - 1)}
						class={secondaryButtonClass}>← Previous</a
					>{:else}<span></span>{/if}<span
					>Page {data.pagination.page} of {data.pagination.pageCount}</span
				>{#if data.pagination.page < data.pagination.pageCount}<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- filtered page link is built from the resolved list path --><a
						href={link(data.pagination.page + 1)}
						class={secondaryButtonClass}>Next →</a
					>{:else}<span></span>{/if}
			</nav>{/if}{/if}
</div>

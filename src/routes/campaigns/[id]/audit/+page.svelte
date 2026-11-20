<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		cardClass,
		inputClass,
		labelClass,
		primaryButtonClass
	} from '$lib/components/campaigns/styles';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();

	const object = (value: unknown): Record<string, unknown> =>
		value !== null && typeof value === 'object' && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	const keys = $derived(
		[
			...new Set([
				...Object.keys(object(data.detail?.oldValue)),
				...Object.keys(object(data.detail?.newValue))
			])
		].sort()
	);
	const movements = $derived(
		(object(data.detail?.newValue).generated_compensatory_movements as unknown[] | undefined) ?? []
	);
	function entityHref(type: string, id: string | null) {
		if (!id) return null;
		if (type === 'sale')
			return resolve('/campaigns/[id]/sales/[saleId]', { id: data.campaign.id, saleId: id });
		if (type === 'bond')
			return resolve('/campaigns/[id]/bonds/[bondId]', { id: data.campaign.id, bondId: id });
		if (type === 'settlement')
			return resolve('/campaigns/[id]/settlements/[settlementId]', {
				id: data.campaign.id,
				settlementId: id
			});
		if (type === 'collector')
			return resolve('/campaigns/[id]/collectors/[collectorId]', {
				id: data.campaign.id,
				collectorId: id
			});
		if (type === 'buyer')
			return resolve('/campaigns/[id]/buyers/[buyerId]', {
				id: data.campaign.id,
				buyerId: id
			});
		return null;
	}
	function auditHref(overrides: Record<string, string | number>) {
		const query = new URLSearchParams(
			Object.fromEntries(
				Object.entries({ ...data.filters, ...overrides })
					.filter(([, value]) => value != null)
					.map(([key, value]) => [key, String(value)])
			)
		);
		return `${resolve('/campaigns/[id]/audit', { id: data.campaign.id })}?${query}`;
	}
</script>

<svelte:head><title>Audit log - {data.campaign.name}</title></svelte:head>
<div class="space-y-6">
	<a
		class="text-sm text-blue-700 hover:underline"
		href={resolve('/campaigns/[id]', { id: data.campaign.id })}>← {data.campaign.name}</a
	>
	<h1 class="text-2xl font-bold">Audit log</h1>
	<form method="GET" class={`${cardClass} grid gap-3 sm:grid-cols-3`}>
		<div>
			<label class={labelClass} for="actor">Actor id</label><input
				class={inputClass}
				id="actor"
				name="actor"
				value={data.filters.actor ?? ''}
			/>
		</div>
		<div>
			<label class={labelClass} for="action">Action</label><input
				class={inputClass}
				id="action"
				name="action"
				value={data.filters.action ?? ''}
			/>
		</div>
		<div>
			<label class={labelClass} for="entityType">Entity type</label><input
				class={inputClass}
				id="entityType"
				name="entityType"
				value={data.filters.entityType ?? ''}
			/>
		</div>
		<div>
			<label class={labelClass} for="from">From</label><input
				class={inputClass}
				type="date"
				id="from"
				name="from"
				value={data.filters.from ?? ''}
			/>
		</div>
		<div>
			<label class={labelClass} for="to">To</label><input
				class={inputClass}
				type="date"
				id="to"
				name="to"
				value={data.filters.to ?? ''}
			/>
		</div>
		<div class="self-end"><button class={primaryButtonClass}>Filter</button></div>
	</form>
	<section class={cardClass}>
		<p class="mb-3 text-sm text-slate-500">
			{data.entries.total} entries · page {data.entries.page}
		</p>
		<table class="min-w-full text-sm">
			<thead
				><tr
					><th class="text-left">Date</th><th class="text-left">Actor</th><th class="text-left"
						>Action</th
					><th class="text-left">Entity</th><th></th></tr
				></thead
			>
			<tbody
				>{#each data.entries.items as entry (entry.id)}
					<tr>
						<td
							>{new Intl.DateTimeFormat('en-US', {
								dateStyle: 'short',
								timeStyle: 'short',
								timeZone: 'America/Argentina/Buenos_Aires'
							}).format(new Date(entry.createdAt))}</td
						>
						<td>{entry.actorName ?? entry.actorUserId ?? 'System'}</td><td>{entry.action}</td><td
							>{entry.entityType}</td
						>
						<td
							><!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
							<a class="text-blue-700 hover:underline" href={auditHref({ detail: entry.id })}
								>Detail</a
							></td
						>
					</tr>
				{:else}<tr
						><td colspan="5" class="py-3 text-slate-500">No audit entries match these filters.</td
						></tr
					>{/each}</tbody
			>
		</table>
		<nav class="mt-4 flex gap-4 text-sm">
			{#if data.entries.page > 1}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a class="text-blue-700" href={auditHref({ page: data.entries.page - 1 })}>Previous</a>{/if}
			{#if data.entries.page * data.entries.pageSize < data.entries.total}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a class="text-blue-700" href={auditHref({ page: data.entries.page + 1 })}>Next</a>{/if}
		</nav>
	</section>
	{#if data.detail}<section class={cardClass}>
			<h2 class="text-lg font-semibold">Change detail</h2>
			<p class="mt-1 text-sm">
				{data.detail.action} · {data.detail.reason ?? 'No reason recorded'}
			</p>
			{#if entityHref(data.detail.entityType, data.detail.entityId)}<a
					class="text-sm text-blue-700 hover:underline"
					href={entityHref(data.detail.entityType, data.detail.entityId)!}>Open affected record</a
				>{/if}
			<table class="mt-4 min-w-full text-sm">
				<thead
					><tr
						><th class="text-left">Field</th><th class="text-left">Before</th><th class="text-left"
							>After</th
						></tr
					></thead
				>
				<tbody
					>{#each keys as key (key)}<tr
							class:font-semibold={JSON.stringify(object(data.detail?.oldValue)[key]) !==
								JSON.stringify(object(data.detail?.newValue)[key])}
							><td>{key}</td><td
								><pre class="whitespace-pre-wrap">{JSON.stringify(
										object(data.detail?.oldValue)[key],
										null,
										2
									) ?? '—'}</pre></td
							><td
								><pre class="whitespace-pre-wrap">{JSON.stringify(
										object(data.detail?.newValue)[key],
										null,
										2
									) ?? '—'}</pre></td
							></tr
						>{/each}</tbody
				>
			</table>
			{#if movements.length}<h3 class="mt-4 font-semibold">Compensating movements</h3>
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				<ul>
					{#each movements as movement (String(movement))}<li>
							<a
								class="text-blue-700 hover:underline"
								href={resolve('/campaigns/[id]/collectors/[collectorId]/ledger', {
									id: data.campaign.id,
									collectorId: String(object(data.detail.newValue).collector_id ?? '')
								}) + `?entry=${String(movement)}`}>{String(movement)}</a
							>
						</li>{/each}
				</ul>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			{/if}
		</section>{/if}
</div>

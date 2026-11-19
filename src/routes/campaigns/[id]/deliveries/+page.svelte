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
	import { DELIVERY_NOTE_REASON_LABELS, deliveryNoteLabel } from '$lib/domain/deliveries';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const campaign = $derived(data.campaign);
	const listHref = $derived(resolve('/campaigns/[id]/deliveries', { id: campaign.id }));
	const noteHref = (noteId: string) =>
		resolve('/campaigns/[id]/deliveries/[noteId]', { id: campaign.id, noteId });
	const dateTime = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' });

	/** This list at another page, keeping the filters (resolved pathname + search, hence the cast). */
	function pageLink(page: number): ResolvedPathname {
		const pairs = Object.entries(data.filters).filter(([, value]) => value);
		if (page > 1) pairs.push(['page', String(page)]);
		const search = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
		return (search ? `${listHref}?${search}` : listHref) as ResolvedPathname;
	}
</script>

<svelte:head>
	<title>Delivery notes - {campaign.name} - Firefighters</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<a
			href={resolve('/campaigns/[id]', { id: campaign.id })}
			class="text-sm text-blue-700 hover:underline">← {campaign.name}</a
		>
		<div class="mt-2 flex flex-wrap items-center justify-between gap-3">
			<h1 class="text-2xl font-bold tracking-tight">Delivery notes</h1>
			{#if data.can.deliver}
				<a
					href={resolve('/campaigns/[id]/deliveries/new', { id: campaign.id })}
					class={primaryButtonClass}>New delivery</a
				>
			{/if}
		</div>
	</div>

	<form method="GET" action={listHref} class="{cardClass} grid gap-4 sm:grid-cols-5 sm:items-end">
		<div>
			<label for="collector" class={labelClass}>Collector</label>
			<select id="collector" name="collector" class={inputClass} value={data.filters.collector}>
				<option value="">All</option>
				{#each data.collectors as c (c.id)}<option value={c.id}>{c.displayName}</option>{/each}
			</select>
		</div>
		<div>
			<label for="number" class={labelClass}>Note number</label>
			<input
				id="number"
				name="number"
				inputmode="numeric"
				class={inputClass}
				value={data.filters.number}
			/>
		</div>
		<div>
			<label for="from" class={labelClass}>From</label>
			<input id="from" name="from" type="date" class={inputClass} value={data.filters.from} />
		</div>
		<div>
			<label for="to" class={labelClass}>To</label>
			<input id="to" name="to" type="date" class={inputClass} value={data.filters.to} />
		</div>
		<div class="flex gap-2">
			<button type="submit" class={primaryButtonClass}>Filter</button>
			<a href={listHref} class={secondaryButtonClass}>Clear</a>
		</div>
	</form>

	<section class="{cardClass} space-y-3" aria-label="Delivery notes">
		{#if data.notes.length === 0}
			<p class="text-sm text-slate-500">No delivery notes match.</p>
		{:else}
			<table class="min-w-full text-sm">
				<thead class="text-left text-xs text-slate-500 uppercase">
					<tr>
						<th class="py-2 pr-3 font-medium">Note</th>
						<th class="py-2 pr-3 font-medium">Date</th>
						<th class="py-2 pr-3 font-medium">Collector</th>
						<th class="py-2 pr-3 font-medium">Reason</th>
						<th class="py-2 pr-3 font-medium">Bonds</th>
						<th class="py-2 font-medium">Issued by</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each data.notes as note (note.id)}
						<tr>
							<td class="py-2 pr-3">
								<a href={noteHref(note.id)} class="font-medium text-blue-700 hover:underline"
									>{deliveryNoteLabel(note.noteNumber)}</a
								>
							</td>
							<td class="py-2 pr-3 tabular-nums">{dateTime.format(new Date(note.issuedAt))}</td>
							<td class="py-2 pr-3">{note.collectorName ?? '—'}</td>
							<td class="py-2 pr-3">{DELIVERY_NOTE_REASON_LABELS[note.reason]}</td>
							<td class="py-2 pr-3 tabular-nums">{note.bondCount}</td>
							<td class="py-2">{note.createdByName ?? '—'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			{#if data.pagination.pageCount > 1}
				<nav aria-label="Pages" class="flex items-center justify-between text-sm">
					<span class="text-slate-500"
						>Page {data.pagination.page} of {data.pagination.pageCount}</span
					>
					<span class="flex gap-2">
						{#if data.pagination.page > 1}<a
								href={pageLink(data.pagination.page - 1)}
								class={secondaryButtonClass}>← Previous</a
							>{/if}
						{#if data.pagination.page < data.pagination.pageCount}<a
								href={pageLink(data.pagination.page + 1)}
								class={secondaryButtonClass}>Next →</a
							>{/if}
					</span>
				</nav>
			{/if}
		{/if}
	</section>
</div>

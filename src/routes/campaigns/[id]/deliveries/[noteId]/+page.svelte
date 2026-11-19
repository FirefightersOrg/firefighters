<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import { cardClass, primaryButtonClass } from '$lib/components/campaigns/styles';
	import { DELIVERY_NOTE_REASON_LABELS, deliveryNoteLabel } from '$lib/domain/deliveries';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const campaign = $derived(data.campaign);
	const note = $derived(data.note);
	const dateTime = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' });
	const bondHref = (bondId: string) =>
		resolve('/campaigns/[id]/bonds/[bondId]', { id: campaign.id, bondId });
	// The print route arrives with SAN-56 (#48): built from the resolved note path.
	const printHref = $derived(
		`${resolve('/campaigns/[id]/deliveries/[noteId]', { id: campaign.id, noteId: note.id })}/print` as ResolvedPathname
	);
	const units = $derived(data.bonds.reduce((total, b) => total + b.units, 0));
</script>

<svelte:head>
	<title>{deliveryNoteLabel(note.noteNumber)} - {campaign.name} - Firefighters</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<a
			href={resolve('/campaigns/[id]/deliveries', { id: campaign.id })}
			class="text-sm text-blue-700 hover:underline">← Delivery notes</a
		>
		<div class="mt-2 flex flex-wrap items-center justify-between gap-3">
			<h1 class="text-2xl font-bold tracking-tight">{deliveryNoteLabel(note.noteNumber)}</h1>
			<a href={printHref} class={primaryButtonClass} target="_blank" rel="noopener">Print</a>
		</div>
	</div>

	<section class="{cardClass} grid gap-3 text-sm sm:grid-cols-3" aria-label="Note">
		<div>
			<p class="text-slate-500">Date</p>
			<p class="font-medium">{dateTime.format(new Date(note.issuedAt))}</p>
		</div>
		<div>
			<p class="text-slate-500">Collector</p>
			<p class="font-medium">{note.collectorName ?? '—'}</p>
		</div>
		<div>
			<p class="text-slate-500">Reason</p>
			<p class="font-medium">{DELIVERY_NOTE_REASON_LABELS[note.reason]}</p>
		</div>
		<div>
			<p class="text-slate-500">Issued by</p>
			<p class="font-medium">{note.createdByName ?? '—'}</p>
		</div>
		<div class="sm:col-span-2">
			<p class="text-slate-500">Notes</p>
			<p class="font-medium">{note.notes ?? '—'}</p>
		</div>
	</section>

	<section class="{cardClass} space-y-2" aria-labelledby="bonds-title">
		<h2 id="bonds-title" class="text-base font-semibold">
			Bonds ({data.bonds.length} · {units} units)
		</h2>
		<ul class="divide-y divide-slate-100 text-sm">
			{#each data.bonds as bond (bond.id)}
				<li class="py-1">
					<a href={bondHref(bond.id)} class="font-mono text-blue-700 hover:underline"
						>{bond.label}</a
					>
				</li>
			{/each}
		</ul>
	</section>
</div>

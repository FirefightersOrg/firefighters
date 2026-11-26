<script lang="ts">
	import { institutionName } from '$lib/institution';
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import { Badge, BondNumber, Button, Disclosure, PageHeader } from '$lib/components/ui';
	import { campaignNumberingConfig } from '$lib/domain/campaigns';
	import { deliveryNoteLabel } from '$lib/domain/deliveries';
	import {
		bondCountLabel,
		deliveryNoteSentence,
		groupBondRanges,
		rangeCountLabel,
		rangeLabel
	} from '$lib/domain/delivery-summary';
	import { formatCampaignNumber } from '$lib/domain/numbering';
	import { isReadableName } from '$lib/domain/parties';
	import { formatDateTime, formatNumber } from '$lib/format';
	import type { PageProps } from './$types';

	/**
	 * Delivery note record (UX plan PR 16): one sentence says what the note records, «Imprimir» is
	 * its action, and the bonds are the ranges that were handed over, with every bond one tap away
	 * underneath. The printable note itself is `…/print`.
	 */
	let { data }: PageProps = $props();
	const campaign = $derived(data.campaign);
	const note = $derived(data.note);
	const numbering = $derived(campaignNumberingConfig(campaign));
	const fmt = (value: number) => formatCampaignNumber(value, numbering);
	const bondHref = (bondId: string) =>
		resolve('/campaigns/[id]/bonds/[bondId]', { id: campaign.id, bondId });
	// The print route arrives with SAN-56 (#48): built from the resolved note path.
	const printHref = $derived(
		`${resolve('/campaigns/[id]/deliveries/[noteId]', { id: campaign.id, noteId: note.id })}/print` as ResolvedPathname
	);
	const units = $derived(data.bonds.reduce((total, b) => total + b.units, 0));
	const ranges = $derived(groupBondRanges(data.bonds));
	const sentence = $derived(
		deliveryNoteSentence({
			reason: note.reason,
			bondCount: data.bonds.length,
			collectorName: isReadableName(note.collectorName) ? note.collectorName : null,
			issuedAt: formatDateTime(note.issuedAt)
		})
	);
	const sorted = $derived(
		[...data.bonds].sort((a, b) => (a.baseNumbers[0] ?? Infinity) - (b.baseNumbers[0] ?? Infinity))
	);
</script>

<svelte:head>
	<title>{deliveryNoteLabel(note.noteNumber)} - {campaign.name} - {institutionName()}</title>
</svelte:head>

<PageHeader
	title={deliveryNoteLabel(note.noteNumber)}
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: campaign.name, href: resolve('/campaigns/[id]', { id: campaign.id }) },
		{ label: 'Entregas', href: resolve('/campaigns/[id]/deliveries', { id: campaign.id }) },
		{ label: deliveryNoteLabel(note.noteNumber) }
	]}
>
	{#snippet actions()}
		<Button variant="primary" size="lg" href={printHref} target="_blank" rel="noopener"
			>Imprimir</Button
		>
	{/snippet}
</PageHeader>

<div class="flex max-w-[640px] flex-col gap-8">
	<section aria-label="Resumen del remito" class="flex flex-col gap-2" data-note-summary>
		<p class="m-0 max-w-[60ch] text-[18px] leading-7 text-text" data-note-sentence>{sentence}</p>
		{#if note.createdByName}
			<p class="m-0 text-body-sm text-muted">Lo registró {note.createdByName}.</p>
		{/if}
		{#if note.notes}
			<p class="m-0 text-body text-text">
				<span class="text-muted">Observaciones:</span>
				{note.notes}
			</p>
		{/if}
		{#if note.status === 'annulled'}
			<div><Badge tone="danger">Remito anulado</Badge></div>
		{/if}
	</section>

	<section aria-labelledby="note-bonds-title" class="flex flex-col gap-3">
		<h2 id="note-bonds-title" class="m-0 border-b border-border-strong pb-2 text-heading-3">
			Bonos
		</h2>
		<ul
			class="m-0 list-none border-b border-border p-0"
			aria-label="Bonos del remito, por rango"
			data-note-ranges
		>
			{#each ranges as range (range.key)}
				<li
					class="flex min-h-12 items-center gap-3 border-b border-border py-1 last:border-b-0"
					data-range={rangeLabel(range, fmt)}
				>
					<span class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
						{#if range.kind === 'range' && range.from !== null && range.to !== null}
							<BondNumber number={fmt(range.from)} />
							<span class="text-body text-muted">a</span>
							<BondNumber number={fmt(range.to)} />
						{:else if range.kind === 'range'}
							<BondNumber number={rangeLabel(range, fmt)} />
						{:else}
							<BondNumber number={rangeLabel(range, fmt)} href={bondHref(range.bondIds[0])} />
						{/if}
					</span>
					<span class="shrink-0 text-body-sm text-muted tabular-nums">{rangeCountLabel(range)}</span
					>
				</li>
			{/each}
		</ul>
		{#if ranges.length > 1 || units !== data.bonds.length}
			<p class="m-0 text-body text-text" data-note-total>
				<span class="font-medium">{bondCountLabel(data.bonds.length)}</span> en este remito{units !==
				data.bonds.length
					? `, ${formatNumber(units)} unidades contando las patas`
					: ''}.
			</p>
		{/if}
		{#if ranges.some((range) => range.kind === 'range')}
			<Disclosure summary="Abrir la ficha de un bono">
				<ul
					class="m-0 flex list-none flex-wrap gap-x-5 p-0"
					aria-label="Bonos del remito, uno por uno"
					data-note-bonds
				>
					{#each sorted as bond (bond.id)}
						<li>
							<BondNumber
								number={bond.baseNumbers.length
									? bond.baseNumbers.map(fmt).join(' + ')
									: 'Ver ficha'}
								size="sm"
								href={bondHref(bond.id)}
							/>
						</li>
					{/each}
				</ul>
			</Disclosure>
		{/if}
	</section>
</div>

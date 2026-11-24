<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import { Button, Card, PageHeader } from '$lib/components/ui';
	import { formatDateTime, formatNumber } from '$lib/format';
	import { DELIVERY_NOTE_REASON_LABELS, deliveryNoteLabel } from '$lib/domain/deliveries';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const campaign = $derived(data.campaign);
	const note = $derived(data.note);
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
		<Button variant="primary" href={printHref} target="_blank" rel="noopener">Imprimir</Button>
	{/snippet}
</PageHeader>

<div class="space-y-6">
	<Card title="Remito">
		<dl class="grid gap-3 text-body sm:grid-cols-3">
			<div>
				<dt class="text-muted">Fecha</dt>
				<dd>{formatDateTime(note.issuedAt)}</dd>
			</div>
			<div>
				<dt class="text-muted">Cobrador</dt>
				<dd>{note.collectorName ?? '—'}</dd>
			</div>
			<div>
				<dt class="text-muted">Motivo</dt>
				<dd>{DELIVERY_NOTE_REASON_LABELS[note.reason]}</dd>
			</div>
			<div>
				<dt class="text-muted">Emitido por</dt>
				<dd>{note.createdByName ?? '—'}</dd>
			</div>
			<div class="sm:col-span-2">
				<dt class="text-muted">Observaciones</dt>
				<dd>{note.notes ?? '—'}</dd>
			</div>
		</dl>
	</Card>

	<Card
		title="Bonos"
		description="{formatNumber(data.bonds.length)} bonos · {formatNumber(units)} unidades"
	>
		<ul class="divide-y divide-border text-body">
			{#each data.bonds as bond (bond.id)}
				<li class="py-1">
					<a
						href={bondHref(bond.id)}
						class="rounded-sm font-mono text-primary-text underline-offset-2 hover:underline"
						>{bond.label}</a
					>
				</li>
			{/each}
		</ul>
	</Card>
</div>

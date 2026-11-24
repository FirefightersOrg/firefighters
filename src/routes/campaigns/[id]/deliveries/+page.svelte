<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import {
		Button,
		Card,
		EmptyState,
		Field,
		PageHeader,
		Select,
		Table,
		TextInput
	} from '$lib/components/ui';
	import type { TableColumn } from '$lib/components/ui';
	import { formatDateTime, formatNumber } from '$lib/format';
	import { DELIVERY_NOTE_REASON_LABELS, deliveryNoteLabel } from '$lib/domain/deliveries';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const campaign = $derived(data.campaign);
	const listHref = $derived(resolve('/campaigns/[id]/deliveries', { id: campaign.id }));
	const noteHref = (noteId: string) =>
		resolve('/campaigns/[id]/deliveries/[noteId]', { id: campaign.id, noteId });

	/** This list at another page, keeping the filters (resolved pathname + search, hence the cast). */
	function pageLink(page: number): ResolvedPathname {
		const pairs = Object.entries(data.filters).filter(([, value]) => value);
		if (page > 1) pairs.push(['page', String(page)]);
		const search = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
		return (search ? `${listHref}?${search}` : listHref) as ResolvedPathname;
	}
	const rows = $derived(
		data.notes.map((note) => ({
			id: note.id,
			note: deliveryNoteLabel(note.noteNumber),
			issuedAt: formatDateTime(note.issuedAt),
			collectorName: note.collectorName ?? '—',
			reason: DELIVERY_NOTE_REASON_LABELS[note.reason],
			bondCount: formatNumber(note.bondCount),
			createdByName: note.createdByName ?? '—'
		}))
	);
	type Row = (typeof rows)[number];
	const columns: TableColumn<Row>[] = [
		{ key: 'note', header: 'Remito' },
		{ key: 'issuedAt', header: 'Fecha' },
		{ key: 'collectorName', header: 'Cobrador' },
		{ key: 'reason', header: 'Motivo' },
		{ key: 'bondCount', header: 'Bonos', align: 'right' },
		{ key: 'createdByName', header: 'Emitido por' }
	];
	const collectorOptions = $derived([
		{ value: '', label: 'Todos' },
		...data.collectors.map((c) => ({ value: c.id, label: c.displayName }))
	]);
	const filtered = $derived(Object.values(data.filters).some(Boolean));
</script>

<svelte:head><title>Remitos de entrega - {campaign.name} - Firefighters</title></svelte:head>

<PageHeader
	title="Remitos de entrega"
	description="Entregas, reasignaciones y devoluciones de bonos a los cobradores."
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: campaign.name, href: resolve('/campaigns/[id]', { id: campaign.id }) },
		{ label: 'Entregas' }
	]}
>
	{#snippet actions()}
		{#if data.can.deliver}
			<Button
				variant="primary"
				icon="plus"
				href={resolve('/campaigns/[id]/deliveries/new', { id: campaign.id })}>Nueva entrega</Button
			>
		{/if}
	{/snippet}
</PageHeader>

<div class="space-y-6">
	<Card>
		<form method="GET" action={listHref} class="grid gap-4 sm:grid-cols-5 sm:items-end">
			<Field label="Cobrador">
				<Select name="collector" options={collectorOptions} value={data.filters.collector ?? ''} />
			</Field>
			<Field label="Número de remito">
				<TextInput name="number" inputmode="numeric" value={data.filters.number ?? ''} />
			</Field>
			<Field label="Desde">
				<TextInput name="from" type="date" value={data.filters.from ?? ''} />
			</Field>
			<Field label="Hasta">
				<TextInput name="to" type="date" value={data.filters.to ?? ''} />
			</Field>
			<div class="flex gap-2">
				<Button type="submit" variant="primary">Filtrar</Button>
				{#if filtered}<Button variant="ghost" href={listHref}>Limpiar</Button>{/if}
			</div>
		</form>
	</Card>

	<Table {columns} {rows} caption="Remitos de entrega">
		{#snippet cell({ row, column })}
			{#if column.key === 'note'}
				<a
					class="rounded-sm text-primary-text underline-offset-2 hover:underline"
					href={noteHref(row.id)}>{row.note}</a
				>
			{:else if column.key === 'bondCount'}
				<span class="tabular-nums">{row.bondCount}</span>
			{:else}
				{row[column.key as keyof Row]}
			{/if}
		{/snippet}
		{#snippet empty()}
			<EmptyState
				title={filtered ? 'Ningún remito coincide con el filtro' : 'Todavía no hay remitos'}
			/>
		{/snippet}
	</Table>

	{#if data.pagination.pageCount > 1}
		<nav aria-label="Páginas de remitos" class="flex items-center justify-between text-body">
			<span class="text-muted">Página {data.pagination.page} de {data.pagination.pageCount}</span>
			<span class="flex gap-2">
				{#if data.pagination.page > 1}
					<Button href={pageLink(data.pagination.page - 1)}>Anterior</Button>
				{/if}
				{#if data.pagination.page < data.pagination.pageCount}
					<Button href={pageLink(data.pagination.page + 1)}>Siguiente</Button>
				{/if}
			</span>
		</nav>
	{/if}
</div>

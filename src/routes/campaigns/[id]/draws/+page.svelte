<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		Button,
		Card,
		EmptyState,
		Field,
		PageHeader,
		Select,
		StatusBadge,
		Table
	} from '$lib/components/ui';
	import type { TableColumn } from '$lib/components/ui';
	import {
		DRAW_STATUSES,
		DRAW_STATUS_LABELS,
		DRAW_TYPES,
		DRAW_TYPE_LABELS
	} from '$lib/domain/draws';
	import { formatDate } from '$lib/format';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const rows = $derived(
		data.draws.map((draw) => ({
			id: draw.id,
			name: draw.name,
			type: DRAW_TYPE_LABELS[draw.drawType],
			date: formatDate(draw.drawDate),
			status: draw.status
		}))
	);
	type Row = (typeof rows)[number];
	const columns: TableColumn<Row>[] = [
		{ key: 'name', header: 'Nombre' },
		{ key: 'type', header: 'Tipo' },
		{ key: 'date', header: 'Fecha' },
		{ key: 'status', header: 'Estado' }
	];
	const typeOptions = [
		{ value: '', label: 'Todos' },
		...DRAW_TYPES.map((type) => ({ value: type, label: DRAW_TYPE_LABELS[type] }))
	];
	const statusOptions = [
		{ value: '', label: 'Todos' },
		...DRAW_STATUSES.map((status) => ({ value: status, label: DRAW_STATUS_LABELS[status] }))
	];
	const filtered = $derived(Boolean(data.filters.type || data.filters.status));
</script>

<svelte:head><title>Sorteos - {data.campaign.name}</title></svelte:head>

<PageHeader
	title="Sorteos"
	description="Sorteos de la campaña, con su tipo, fecha y estado."
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: data.campaign.name, href: resolve('/campaigns/[id]', { id: data.campaign.id }) },
		{ label: 'Sorteos' }
	]}
>
	{#snippet actions()}
		{#if data.can.create}
			<Button
				variant="primary"
				icon="plus"
				href={resolve('/campaigns/[id]/draws/new', { id: data.campaign.id })}>Nuevo sorteo</Button
			>
		{/if}
	{/snippet}
</PageHeader>

<div class="space-y-6">
	<Card>
		<form method="GET" class="grid gap-4 sm:grid-cols-3 sm:items-end">
			<Field label="Tipo">
				<Select name="type" options={typeOptions} value={data.filters.type ?? ''} />
			</Field>
			<Field label="Estado">
				<Select name="status" options={statusOptions} value={data.filters.status ?? ''} />
			</Field>
			<div class="flex gap-2">
				<Button type="submit" variant="primary">Filtrar</Button>
				{#if filtered}
					<Button variant="ghost" href={resolve('/campaigns/[id]/draws', { id: data.campaign.id })}
						>Limpiar</Button
					>
				{/if}
			</div>
		</form>
	</Card>

	<Table {columns} {rows} caption="Sorteos de la campaña">
		{#snippet cell({ row, column })}
			{#if column.key === 'name'}
				<a
					class="rounded-sm text-primary-text underline-offset-2 hover:underline"
					href={resolve('/campaigns/[id]/draws/[drawId]', {
						id: data.campaign.id,
						drawId: row.id
					})}>{row.name}</a
				>
			{:else if column.key === 'status'}
				<StatusBadge kind="draw" status={row.status} />
			{:else}
				{row[column.key as keyof Row]}
			{/if}
		{/snippet}
		{#snippet empty()}
			<EmptyState
				title={filtered ? 'Ningún sorteo coincide con el filtro' : 'Todavía no hay sorteos'}
			>
				{#if !filtered && data.can.create}Crear el primero con «Nuevo sorteo».{/if}
			</EmptyState>
		{/snippet}
	</Table>
</div>

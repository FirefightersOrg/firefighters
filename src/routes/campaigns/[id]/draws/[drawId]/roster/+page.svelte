<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		Badge,
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
	import { formatNumber } from '$lib/format';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type Entry = (typeof data.entries)[number];
	const columns: TableColumn<Entry>[] = [
		{ key: 'formattedNumber', header: 'Número', mono: true },
		{ key: 'bondLabel', header: 'Bono', mono: true },
		{ key: 'buyerName', header: 'Comprador' },
		{ key: 'collectorName', header: 'Cobrador' },
		{ key: 'eligibility', header: 'Elegibilidad' }
	];
	const eligibilityOptions = [
		{ value: '', label: 'Todos' },
		{ value: 'eligible', label: 'Habilitado' },
		{ value: 'ineligible', label: 'No habilitado' }
	];
	const title = $derived(
		data.roster.status === 'frozen' ? 'Padrón congelado' : 'Padrón generado (vigente)'
	);
</script>

<svelte:head><title>Padrón - {data.draw.name}</title></svelte:head>

<PageHeader
	{title}
	description="{formatNumber(data.pagination.total)} números coinciden con la búsqueda."
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: data.campaign.name, href: resolve('/campaigns/[id]', { id: data.campaign.id }) },
		{ label: 'Sorteos', href: resolve('/campaigns/[id]/draws', { id: data.campaign.id }) },
		{
			label: data.draw.name,
			href: resolve('/campaigns/[id]/draws/[drawId]', {
				id: data.campaign.id,
				drawId: data.draw.id
			})
		},
		{ label: 'Padrón' }
	]}
/>

<div class="space-y-6">
	<Card>
		<form method="GET" class="grid gap-4 sm:grid-cols-3 sm:items-end">
			<Field label="Número, bono, comprador o cobrador">
				<TextInput name="q" value={data.filters.q} />
			</Field>
			<Field label="Elegibilidad">
				<Select
					name="eligibility"
					options={eligibilityOptions}
					value={data.filters.eligibility ?? ''}
				/>
			</Field>
			<div><Button type="submit" variant="primary" icon="search">Buscar</Button></div>
		</form>
	</Card>

	<Table
		{columns}
		rows={data.entries}
		density="compact"
		maxHeight="70vh"
		caption="Números del padrón"
	>
		{#snippet cell({ row, column })}
			{#if column.key === 'formattedNumber'}
				{row.formattedNumber}
				{#if row.numberKind === 'extraordinary'}<Badge tone="info">Extra (sorteo anterior)</Badge
					>{/if}
			{:else if column.key === 'eligibility'}
				{row.eligible ? 'Habilitado' : `No habilitado — ${row.reasonLabel}`}
			{:else}
				{row[column.key as keyof Entry]}
			{/if}
		{/snippet}
		{#snippet empty()}
			<EmptyState title="Ningún número del padrón coincide con la búsqueda" />
		{/snippet}
	</Table>

	{#if data.pagination.pages > 1}
		<nav aria-label="Páginas del padrón" class="flex items-center justify-between text-body">
			<span>Página {data.pagination.page} de {data.pagination.pages}</span>
			<div class="flex gap-2">
				{#each [{ page: data.pagination.page - 1, label: 'Anterior', show: data.pagination.page > 1 }, { page: data.pagination.page + 1, label: 'Siguiente', show: data.pagination.page < data.pagination.pages }] as step (step.label)}
					{#if step.show}
						<form method="GET">
							<input type="hidden" name="q" value={data.filters.q} />
							<input type="hidden" name="eligibility" value={data.filters.eligibility} />
							<input type="hidden" name="page" value={step.page} />
							<Button type="submit">{step.label}</Button>
						</form>
					{/if}
				{/each}
			</div>
		</nav>
	{/if}
</div>

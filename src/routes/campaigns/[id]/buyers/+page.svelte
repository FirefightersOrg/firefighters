<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import Pagination from '$lib/components/layout/Pagination.svelte';
	import {
		Button,
		EmptyState,
		Field,
		PageHeader,
		Select,
		Table,
		TextInput
	} from '$lib/components/ui';
	import type { TableColumn } from '$lib/components/ui';
	import { buyerDisplayName, buyerIdentification, BUYER_TYPE_LABELS } from '$lib/domain/parties';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const href = $derived(resolve('/campaigns/[id]/buyers', { id: data.campaign.id }));
	function pageLink(page: number): ResolvedPathname {
		const pairs = Object.entries(data.query).filter(([, value]) => value);
		if (page > 1) pairs.push(['page', String(page)]);
		const search = pairs.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
		return (search ? `${href}?${search}` : href) as ResolvedPathname;
	}
	const collector = (id: string | null) => data.collectors.find((c) => c.id === id);

	const rows = $derived(
		data.buyers.map((buyer) => ({
			id: buyer.id,
			name: buyerDisplayName(buyer),
			type: BUYER_TYPE_LABELS[buyer.type],
			identification: buyerIdentification(buyer) ?? '—',
			phone: buyer.phone ?? '—',
			usualCollector: collector(buyer.usualCollectorId)?.displayName ?? '—'
		}))
	);
	type Row = (typeof rows)[number];
	const columns: TableColumn<Row>[] = [
		{ key: 'name', header: 'Nombre' },
		{ key: 'type', header: 'Tipo' },
		{ key: 'identification', header: 'Identificación', mono: true },
		{ key: 'phone', header: 'Teléfono' },
		{ key: 'usualCollector', header: 'Cobrador habitual' }
	];
</script>

<svelte:head><title>Compradores - {data.campaign.name} - Firefighters</title></svelte:head>

<PageHeader
	title="Compradores"
	description="Personas y empresas que compran bonos."
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: data.campaign.name, href: resolve('/campaigns/[id]', { id: data.campaign.id }) },
		{ label: 'Compradores' }
	]}
>
	{#snippet actions()}
		{#if data.can.manage}
			<Button
				variant="primary"
				icon="plus"
				href={resolve('/campaigns/[id]/buyers/new', { id: data.campaign.id })}
			>
				Nuevo comprador
			</Button>
		{/if}
	{/snippet}
</PageHeader>

<form
	method="GET"
	action={href}
	class="mb-6 grid gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-3 sm:items-end sm:p-6"
>
	<Field label="Buscar" id="q">
		<TextInput
			name="q"
			type="search"
			value={data.query.q}
			placeholder="Nombre, documento o CUIT"
			autocomplete="off"
		/>
	</Field>
	<Field label="Tipo" id="type">
		<Select
			name="type"
			value={data.query.type}
			options={[
				{ value: '', label: 'Todos' },
				{ value: 'individual', label: BUYER_TYPE_LABELS.individual },
				{ value: 'business', label: BUYER_TYPE_LABELS.business }
			]}
		/>
	</Field>
	<div class="flex gap-2">
		<Button type="submit" variant="primary" icon="search">Buscar</Button>
		<Button {href}>Limpiar</Button>
	</div>
</form>

<Table {columns} {rows} caption="Compradores registrados">
	{#snippet cell({ row, column })}
		{#if column.key === 'name'}
			<a
				href={resolve('/campaigns/[id]/buyers/[buyerId]', {
					id: data.campaign.id,
					buyerId: row.id
				})}
				class="rounded-sm text-primary-text underline-offset-2 hover:underline"
			>
				{row.name}
			</a>
		{:else}
			{row[column.key as keyof Row]}
		{/if}
	{/snippet}
	{#snippet empty()}
		<EmptyState title="No hay compradores para estos filtros" icon="search">
			Probar con otra búsqueda o limpiar los filtros.
		</EmptyState>
	{/snippet}
</Table>

<Pagination page={data.pagination.page} pageCount={data.pagination.pageCount} hrefFor={pageLink} />

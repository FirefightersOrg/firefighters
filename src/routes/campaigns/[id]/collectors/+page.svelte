<script lang="ts">
	import { institutionName } from '$lib/institution';
	import { resolve } from '$app/paths';
	import Pagination from '$lib/components/layout/Pagination.svelte';
	import {
		Button,
		EmptyState,
		Field,
		PageHeader,
		Select,
		StatusBadge,
		Table,
		TextInput
	} from '$lib/components/ui';
	import type { TableColumn } from '$lib/components/ui';
	import { COLLECTOR_STATUSES, COLLECTOR_STATUS_LABELS } from '$lib/domain/parties';
	import { formatNumber } from '$lib/format';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const listHref = $derived(resolve('/campaigns/[id]/collectors', { id: data.campaign.id }));
	const link = (page: number) => {
		const pairs = [
			data.query.q ? `q=${encodeURIComponent(data.query.q)}` : '',
			data.query.status ? `status=${data.query.status}` : '',
			page > 1 ? `page=${page}` : ''
		].filter(Boolean);
		return `${listHref}?${pairs.join('&')}`;
	};

	const rows = $derived(
		data.collectors.map((collector) => ({
			id: collector.id,
			name: collector.displayName,
			phone: collector.phone ?? '—',
			email: collector.email ?? '—',
			status: collector.status,
			linkedUser: collector.userProfileId ? 'Sí' : 'No',
			assignedBonds: formatNumber(collector.assignedBonds)
		}))
	);
	type Row = (typeof rows)[number];
	const columns: TableColumn<Row>[] = [
		{ key: 'name', header: 'Nombre' },
		{ key: 'phone', header: 'Teléfono' },
		{ key: 'email', header: 'Correo electrónico' },
		{ key: 'status', header: 'Estado' },
		{ key: 'linkedUser', header: 'Usuario vinculado' },
		{ key: 'assignedBonds', header: 'Bonos asignados en esta campaña', align: 'right' }
	];
</script>

<svelte:head><title>Cobradores - {data.campaign.name} - {institutionName()}</title></svelte:head>

<PageHeader
	title="Cobradores"
	description="Cobradores que reciben bonos y registran pagos."
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: data.campaign.name, href: resolve('/campaigns/[id]', { id: data.campaign.id }) },
		{ label: 'Cobradores' }
	]}
>
	{#snippet actions()}
		{#if data.can.manage}
			<Button
				variant="primary"
				icon="plus"
				href={resolve('/campaigns/[id]/collectors/new', { id: data.campaign.id })}
			>
				Nuevo cobrador
			</Button>
		{/if}
	{/snippet}
</PageHeader>

<form
	method="GET"
	action={listHref}
	class="mb-6 grid gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-3 sm:items-end sm:p-6"
>
	<Field label="Buscar" id="q">
		<TextInput
			name="q"
			type="search"
			value={data.query.q}
			placeholder="Nombre, teléfono o correo"
			autocomplete="off"
		/>
	</Field>
	<Field label="Estado" id="status">
		<Select
			name="status"
			value={data.query.status}
			options={[
				{ value: '', label: 'Todos' },
				...COLLECTOR_STATUSES.map((status) => ({
					value: status,
					label: COLLECTOR_STATUS_LABELS[status]
				}))
			]}
		/>
	</Field>
	<div class="flex gap-2">
		<Button type="submit" variant="primary" icon="search">Aplicar filtros</Button>
		<Button href={listHref}>Limpiar</Button>
	</div>
</form>

<Table {columns} {rows} caption="Cobradores registrados">
	{#snippet cell({ row, column })}
		{#if column.key === 'name'}
			<a
				href={resolve('/campaigns/[id]/collectors/[collectorId]', {
					id: data.campaign.id,
					collectorId: row.id
				})}
				class="rounded-sm text-primary-text underline-offset-2 hover:underline"
			>
				{row.name}
			</a>
		{:else if column.key === 'status'}
			<StatusBadge kind="collector" status={row.status} />
		{:else}
			{row[column.key as keyof Row]}
		{/if}
	{/snippet}
	{#snippet empty()}
		<EmptyState title="No hay cobradores para estos filtros" icon="search">
			Probar con otra búsqueda o limpiar los filtros.
		</EmptyState>
	{/snippet}
</Table>

<Pagination page={data.pagination.page} pageCount={data.pagination.pageCount} hrefFor={link} />

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
		Table,
		TextInput
	} from '$lib/components/ui';
	import type { TableColumn } from '$lib/components/ui';
	import { formatDate, formatMoney } from '$lib/format';
	import { SETTLEMENT_STATUS_LABELS, SETTLEMENT_STATUSES } from '$lib/domain/payments';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	type Row = (typeof data.settlements)[number];
	const columns: TableColumn<Row>[] = [
		{ key: 'number', header: 'Número' },
		{ key: 'collectorName', header: 'Cobrador' },
		{ key: 'status', header: 'Estado' },
		{ key: 'total', header: 'Total', align: 'right' },
		{ key: 'openedAt', header: 'Apertura' }
	];
	const collectorOptions = $derived([
		{ value: '', label: 'Todos' },
		...data.collectors.map((c) => ({ value: c.id, label: c.displayName }))
	]);
	const statusOptions = [
		{ value: '', label: 'Todos' },
		...SETTLEMENT_STATUSES.map((s) => ({ value: s, label: SETTLEMENT_STATUS_LABELS[s] }))
	];
	const filtered = $derived(
		Boolean(data.filters.collector || data.filters.status || data.filters.from || data.filters.to)
	);
</script>

<svelte:head><title>Rendiciones - {data.campaign.name}</title></svelte:head>

<PageHeader
	title="Rendiciones"
	description="Rendiciones de los cobradores, con su estado y total."
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: data.campaign.name, href: resolve('/campaigns/[id]', { id: data.campaign.id }) },
		{ label: 'Rendiciones' }
	]}
>
	{#snippet actions()}
		{#if data.can.create}
			<Button
				variant="primary"
				icon="plus"
				href={resolve('/campaigns/[id]/settlements/new', { id: data.campaign.id })}
				>Abrir rendición</Button
			>
		{/if}
	{/snippet}
</PageHeader>

<div class="space-y-6">
	<Card>
		<form method="GET" class="grid gap-4 sm:grid-cols-5 sm:items-end">
			<Field label="Cobrador">
				<Select name="collector" options={collectorOptions} value={data.filters.collector ?? ''} />
			</Field>
			<Field label="Estado">
				<Select name="status" options={statusOptions} value={data.filters.status ?? ''} />
			</Field>
			<Field label="Desde">
				<TextInput type="date" name="from" value={data.filters.from ?? ''} />
			</Field>
			<Field label="Hasta">
				<TextInput type="date" name="to" value={data.filters.to ?? ''} />
			</Field>
			<div class="flex gap-2">
				<Button type="submit" variant="primary">Filtrar</Button>
				{#if filtered}
					<Button
						variant="ghost"
						href={resolve('/campaigns/[id]/settlements', { id: data.campaign.id })}>Limpiar</Button
					>
				{/if}
			</div>
		</form>
	</Card>

	<Table {columns} rows={data.settlements} caption="Rendiciones de la campaña">
		{#snippet cell({ row, column })}
			{#if column.key === 'number'}
				<a
					class="rounded-sm text-primary-text underline-offset-2 hover:underline"
					href={resolve('/campaigns/[id]/settlements/[settlementId]', {
						id: data.campaign.id,
						settlementId: row.id
					})}>#{row.settlementNumber}</a
				>
			{:else if column.key === 'status'}
				<StatusBadge kind="settlement" status={row.status} />
			{:else if column.key === 'total'}
				<span class="tabular-nums"
					>{formatMoney(row.totals.totalAmount, { decimals: 'always' })}</span
				>
			{:else if column.key === 'openedAt'}
				{formatDate(row.openedAt)}
			{:else}
				{row.collectorName}
			{/if}
		{/snippet}
		{#snippet empty()}
			<EmptyState
				title={filtered ? 'Ninguna rendición coincide con el filtro' : 'Todavía no hay rendiciones'}
			/>
		{/snippet}
	</Table>
</div>

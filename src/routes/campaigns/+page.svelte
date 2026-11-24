<script lang="ts">
	import { resolve } from '$app/paths';
	import { Button, EmptyState, PageHeader, StatusBadge, Table } from '$lib/components/ui';
	import type { TableColumn } from '$lib/components/ui';
	import { formatDate, formatMoney, formatNumber } from '$lib/format';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const rows = $derived(
		data.campaigns.map((campaign) => ({
			id: campaign.id,
			name: campaign.name,
			status: campaign.status,
			dates: `${formatDate(campaign.startsAt)} – ${formatDate(campaign.endsAt)}`,
			bondValue: formatMoney(campaign.simpleBondValue),
			installments: `${campaign.installmentCount} × ${formatMoney(campaign.installmentValue)}`,
			digits: formatNumber(campaign.numberDigits)
		}))
	);
	type Row = (typeof rows)[number];

	const columns: TableColumn<Row>[] = [
		{ key: 'name', header: 'Nombre' },
		{ key: 'status', header: 'Estado' },
		{ key: 'dates', header: 'Fechas' },
		{ key: 'bondValue', header: 'Valor del bono', align: 'right' },
		{ key: 'installments', header: 'Cuotas', align: 'right' },
		{ key: 'digits', header: 'Dígitos', align: 'right' }
	];
</script>

<svelte:head>
	<title>Campañas - Firefighters</title>
</svelte:head>

<PageHeader title="Campañas" description="Campañas de bonos, de la más reciente a la más antigua.">
	{#snippet actions()}
		{#if data.canCreate}
			<Button variant="primary" href={resolve('/campaigns/new')} icon="plus">Nueva campaña</Button>
		{/if}
	{/snippet}
</PageHeader>

<Table {columns} {rows} caption="Campañas registradas">
	{#snippet cell({ row, column })}
		{#if column.key === 'name'}
			<a
				href={resolve('/campaigns/[id]', { id: row.id })}
				class="rounded-sm text-primary-text underline-offset-2 hover:underline"
			>
				{row.name}
			</a>
		{:else if column.key === 'status'}
			<StatusBadge kind="campaign" status={row.status} />
		{:else}
			{row[column.key as keyof Row]}
		{/if}
	{/snippet}
	{#snippet empty()}
		<EmptyState title="Todavía no hay campañas">
			{#if data.canCreate}Crear la primera con «Nueva campaña».{/if}
		</EmptyState>
	{/snippet}
</Table>

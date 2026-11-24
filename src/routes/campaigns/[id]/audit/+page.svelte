<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		Button,
		Card,
		EmptyState,
		Field,
		PageHeader,
		Table,
		TextInput
	} from '$lib/components/ui';
	import type { TableColumn } from '$lib/components/ui';
	import { formatDateTime, formatNumber } from '$lib/format';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();

	const object = (value: unknown): Record<string, unknown> =>
		value !== null && typeof value === 'object' && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	const keys = $derived(
		[
			...new Set([
				...Object.keys(object(data.detail?.oldValue)),
				...Object.keys(object(data.detail?.newValue))
			])
		].sort()
	);
	const movements = $derived(
		(object(data.detail?.newValue).generated_compensatory_movements as unknown[] | undefined) ?? []
	);
	function entityHref(type: string, id: string | null) {
		if (!id) return null;
		if (type === 'sale')
			return resolve('/campaigns/[id]/sales/[saleId]', { id: data.campaign.id, saleId: id });
		if (type === 'bond')
			return resolve('/campaigns/[id]/bonds/[bondId]', { id: data.campaign.id, bondId: id });
		if (type === 'settlement')
			return resolve('/campaigns/[id]/settlements/[settlementId]', {
				id: data.campaign.id,
				settlementId: id
			});
		if (type === 'collector')
			return resolve('/campaigns/[id]/collectors/[collectorId]', {
				id: data.campaign.id,
				collectorId: id
			});
		if (type === 'buyer')
			return resolve('/campaigns/[id]/buyers/[buyerId]', {
				id: data.campaign.id,
				buyerId: id
			});
		return null;
	}
	function auditHref(overrides: Record<string, string | number>) {
		const query = new URLSearchParams(
			Object.fromEntries(
				Object.entries({ ...data.filters, ...overrides })
					.filter(([, value]) => value != null)
					.map(([key, value]) => [key, String(value)])
			)
		);
		return `${resolve('/campaigns/[id]/audit', { id: data.campaign.id })}?${query}`;
	}
	const rows = $derived(
		data.entries.items.map((entry) => ({
			id: entry.id,
			createdAt: formatDateTime(entry.createdAt),
			actor: entry.actorName ?? entry.actorUserId ?? 'Sistema',
			action: entry.action,
			entityType: entry.entityType,
			detail: auditHref({ detail: entry.id })
		}))
	);
	type Entry = (typeof rows)[number];
	const columns: TableColumn<Entry>[] = [
		{ key: 'createdAt', header: 'Fecha' },
		{ key: 'actor', header: 'Usuario' },
		{ key: 'action', header: 'Acción', mono: true },
		{ key: 'entityType', header: 'Entidad', mono: true },
		{ key: 'detail', header: '' }
	];
	const show = (value: unknown) => JSON.stringify(value, null, 2) ?? '—';
	const changed = (key: string) =>
		JSON.stringify(object(data.detail?.oldValue)[key]) !==
		JSON.stringify(object(data.detail?.newValue)[key]);
</script>

<svelte:head><title>Auditoría - {data.campaign.name}</title></svelte:head>

<PageHeader
	title="Auditoría"
	description="Historial completo de cambios de la campaña."
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: data.campaign.name, href: resolve('/campaigns/[id]', { id: data.campaign.id }) },
		{ label: 'Auditoría' }
	]}
/>

<div class="space-y-6">
	<Card>
		<form method="GET" class="grid gap-4 sm:grid-cols-3 sm:items-end">
			<Field label="Id del usuario" optional>
				<TextInput name="actor" value={data.filters.actor ?? ''} mono />
			</Field>
			<Field label="Acción" optional>
				<TextInput name="action" value={data.filters.action ?? ''} mono />
			</Field>
			<Field label="Tipo de entidad" optional>
				<TextInput name="entityType" value={data.filters.entityType ?? ''} mono />
			</Field>
			<Field label="Desde" optional>
				<TextInput name="from" type="date" value={data.filters.from ?? ''} />
			</Field>
			<Field label="Hasta" optional>
				<TextInput name="to" type="date" value={data.filters.to ?? ''} />
			</Field>
			<div><Button type="submit" variant="primary" icon="search">Filtrar</Button></div>
		</form>
	</Card>

	<p class="text-body-sm text-muted">
		{formatNumber(data.entries.total)} registros · página {data.entries.page}
	</p>
	<Table {columns} {rows} caption="Registros de auditoría">
		{#snippet cell({ row, column })}
			{#if column.key === 'detail'}
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				<a class="rounded-sm text-primary-text underline-offset-2 hover:underline" href={row.detail}
					>Detalle</a
				>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			{:else}
				{row[column.key as keyof Entry]}
			{/if}
		{/snippet}
		{#snippet empty()}
			<EmptyState title="Ningún registro coincide con los filtros" />
		{/snippet}
	</Table>
	<nav aria-label="Páginas de la auditoría" class="flex gap-2">
		{#if data.entries.page > 1}
			<Button href={auditHref({ page: data.entries.page - 1 })}>Anterior</Button>
		{/if}
		{#if data.entries.page * data.entries.pageSize < data.entries.total}
			<Button href={auditHref({ page: data.entries.page + 1 })}>Siguiente</Button>
		{/if}
	</nav>

	{#if data.detail}
		<Card
			title="Detalle del cambio"
			description="{data.detail.action} · {data.detail.reason ?? 'Sin motivo registrado'}"
		>
			{#if entityHref(data.detail.entityType, data.detail.entityId)}
				<a
					class="rounded-sm text-body text-primary-text underline-offset-2 hover:underline"
					href={entityHref(data.detail.entityType, data.detail.entityId)!}
					>Abrir el registro afectado</a
				>
			{/if}
			<div class="mt-4 overflow-x-auto">
				<table class="w-full border-collapse text-body-sm">
					<caption class="sr-only">Campos antes y después del cambio</caption>
					<thead>
						<tr class="border-b border-border text-left text-label text-muted">
							<th scope="col" class="px-3 py-2">Campo</th>
							<th scope="col" class="px-3 py-2">Antes</th>
							<th scope="col" class="px-3 py-2">Después</th>
						</tr>
					</thead>
					<tbody>
						{#each keys as key (key)}
							<tr class="border-b border-border last:border-b-0" class:font-semibold={changed(key)}>
								<td class="px-3 py-2 font-mono">{key}</td>
								<td class="px-3 py-2"
									><pre class="whitespace-pre-wrap">{show(
											object(data.detail?.oldValue)[key]
										)}</pre></td
								>
								<td class="px-3 py-2"
									><pre class="whitespace-pre-wrap">{show(
											object(data.detail?.newValue)[key]
										)}</pre></td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if movements.length}
				<h3 class="mt-4 text-heading-3">Movimientos compensatorios</h3>
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				<ul class="mt-2 space-y-1 text-body">
					{#each movements as movement (String(movement))}
						<li>
							<a
								class="rounded-sm font-mono text-primary-text underline-offset-2 hover:underline"
								href={resolve('/campaigns/[id]/collectors/[collectorId]/ledger', {
									id: data.campaign.id,
									collectorId: String(object(data.detail.newValue).collector_id ?? '')
								}) + `?entry=${String(movement)}`}>{String(movement)}</a
							>
						</li>
					{/each}
				</ul>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			{/if}
		</Card>
	{/if}
</div>

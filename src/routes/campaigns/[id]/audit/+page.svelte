<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		Button,
		Card,
		EmptyState,
		Field,
		PageHeader,
		Table,
		TextInput,
		FilterBar,
		Select
	} from '$lib/components/ui';
	import type { TableColumn } from '$lib/components/ui';
	import { auditAction, auditEntity, AUDIT_ENTITIES, AUDIT_ACTION_CODES } from '$lib/audit-copy';
	import { institutionName } from '$lib/institution';
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
	function auditHref(overrides: Record<string, string | number | null>) {
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
			actor: `${entry.actorName ?? (entry.actorUserId ? 'Un usuario' : 'Sistema')}. ${formatDateTime(entry.createdAt)}`,
			action: `${auditAction(entry.action)} (${auditEntity(entry.entityType).toLowerCase()})`,
			entityType: auditEntity(entry.entityType),
			subject: entry.subject ?? auditEntity(entry.entityType),
			detail: auditHref({ detail: entry.id })
		}))
	);
	type Entry = (typeof rows)[number];
	const columns: TableColumn<Entry>[] = [
		{ key: 'action', header: 'Acción', stack: 'primary' },
		{ key: 'subject', header: 'Bono o persona', stack: 'secondary' },
		{ key: 'actor', header: 'Usuario y fecha', stack: 'secondary' },
		{ key: 'detail', header: 'Detalle', stack: 'trailing' }
	];
	const show = (value: unknown) => JSON.stringify(value, null, 2) ?? '—';
	const changed = (key: string) =>
		JSON.stringify(object(data.detail?.oldValue)[key]) !==
		JSON.stringify(object(data.detail?.newValue)[key]);
</script>

<svelte:head><title>Auditoría - {data.campaign.name} - {institutionName()}</title></svelte:head>

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
	<FilterBar
		action={resolve('/campaigns/[id]/audit', { id: data.campaign.id })}
		searchName="person"
		searchLabel="Nombre de la persona"
		searchValue={data.filters.person ?? ''}
		clearHref={resolve('/campaigns/[id]/audit', { id: data.campaign.id })}
		applied={Object.entries(data.filters).flatMap(([key, value]) => {
			if (!value || key === 'page') return [];
			const labels: Record<string, string> = {
				person: 'Persona',
				actor: 'Usuario seleccionado',
				action: 'Acción',
				entityType: 'Entidad',
				from: 'Desde',
				to: 'Hasta'
			};
			const text =
				key === 'actor'
					? ''
					: key === 'action'
						? auditAction(String(value))
						: key === 'entityType'
							? auditEntity(String(value))
							: String(value);
			return [
				{
					label: `${labels[key]}${text ? `: ${text}` : ''}`,
					removeHref: auditHref({ [key]: null, page: 1 })
				}
			];
		})}
	>
		{#snippet filters()}
			{#if data.filters.actor}<input type="hidden" name="actor" value={data.filters.actor} />{/if}
			<Field label="Acción" optional
				><Select
					name="action"
					value={data.filters.action ?? ''}
					options={[
						{ value: '', label: 'Todas' },
						...[
							...new Set([
								...AUDIT_ACTION_CODES,
								...(data.filters.action ? [data.filters.action] : [])
							])
						].map((value) => ({
							value,
							label: `${auditAction(value)} (${auditEntity(value.split('.')[0]).toLowerCase()})`
						}))
					]}
				/></Field
			>
			<Field label="Tipo de entidad" optional
				><Select
					name="entityType"
					value={data.filters.entityType ?? ''}
					options={[
						{ value: '', label: 'Todas' },
						...Object.entries(AUDIT_ENTITIES).map(([value, label]) => ({ value, label }))
					]}
				/></Field
			>
			<Field label="Desde" optional
				><TextInput name="from" type="date" value={data.filters.from ?? ''} /></Field
			>
			<Field label="Hasta" optional
				><TextInput name="to" type="date" value={data.filters.to ?? ''} /></Field
			>
		{/snippet}
	</FilterBar>
	<p class="text-body-sm text-muted">
		Busca al usuario que hizo el cambio y a las personas del registro, según los permisos
		disponibles.
	</p>

	<p class="text-body-sm text-muted">
		{formatNumber(data.entries.total)} registros. Página {data.entries.page}
	</p>
	<Table {columns} {rows} stack caption="Registros de auditoría">
		{#snippet cell({ row, column })}
			{#if column.key === 'detail'}
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				<a
					class="inline-flex min-h-touch items-center rounded-sm text-primary-text underline-offset-2 hover:underline"
					href={row.detail}>Detalle</a
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
			id="audit-detail"
			title="Detalle del cambio"
			description="{data.detail.action}. {data.detail.reason ?? 'Sin motivo registrado'}"
		>
			<dl class="mb-4 space-y-1 break-all text-body-sm">
				<div>
					<dt>Acción</dt>
					<dd class="font-mono">{data.detail.action}</dd>
				</div>
				<div>
					<dt>Entidad</dt>
					<dd class="font-mono">{data.detail.entityType}: {data.detail.entityId}</dd>
				</div>
				<div>
					<dt>Usuario</dt>
					<dd class="font-mono">{data.detail.actorUserId ?? 'Sistema'}</dd>
				</div>
				<div>
					<dt>Solicitud</dt>
					<dd class="font-mono">{data.detail.requestId}</dd>
				</div>
			</dl>
			{#if entityHref(data.detail.entityType, data.detail.entityId)}
				<a
					class="inline-flex min-h-touch items-center rounded-sm text-body text-primary-text underline-offset-2 hover:underline"
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
									><pre class="whitespace-pre-wrap break-all">{show(
											object(data.detail?.oldValue)[key]
										)}</pre></td
								>
								<td class="px-3 py-2"
									><pre class="whitespace-pre-wrap break-all">{show(
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
								class="inline-flex min-h-touch items-center rounded-sm font-mono text-primary-text underline-offset-2 hover:underline"
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

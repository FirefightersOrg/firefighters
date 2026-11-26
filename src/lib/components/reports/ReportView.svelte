<script lang="ts">
	import { Badge, Button, BondNumber, Disclosure, EmptyState, Table } from '$lib/components/ui';
	import type { TableColumn } from '$lib/components/ui';
	import {
		reportHref,
		REPORT_ROWS_PER_PAGE,
		type ReportField,
		type ReportRow
	} from '$lib/report-views';
	import ExportLinks from './ExportLinks.svelte';
	import type { ReportExportKey } from '$lib/domain/report-exports';
	let {
		campaignId,
		base,
		params,
		views,
		view,
		page,
		title,
		fields,
		rows,
		totals = [],
		report,
		canExport,
		empty: emptyMessage = 'Ningún registro coincide con los filtros.'
	}: {
		campaignId: string;
		base: string;
		params: Record<string, string | null | undefined>;
		views: readonly { id: string; label: string }[];
		view: string;
		page: number;
		title: string;
		fields: ReportField[];
		rows: ReportRow[];
		totals?: { label: string; value: string }[];
		report?: ReportExportKey;
		canExport: boolean;
		empty?: string;
	} = $props();
	const lastPage = $derived(Math.max(1, Math.ceil(rows.length / REPORT_ROWS_PER_PAGE)));
	const currentPage = $derived(Math.min(page, lastPage));
	const shown = $derived(
		rows.slice((currentPage - 1) * REPORT_ROWS_PER_PAGE, currentPage * REPORT_ROWS_PER_PAGE)
	);
	// Dense reports keep every figure reachable, with at most six desktop columns.
	const main = $derived(fields.slice(0, fields.length > 6 ? 4 : 6));
	const extra = $derived(fields.slice(main.length));
	const columns = $derived<TableColumn<ReportRow>[]>([
		...main.map((field, i) => ({
			key: field.key,
			header: field.label,
			align: field.numeric ? ('right' as const) : ('left' as const),
			stack: i === 0 ? ('primary' as const) : undefined
		})),
		...(extra.length ? [{ key: '_detail', header: 'Más datos', stack: 'secondary' as const }] : [])
	]);
</script>

{#snippet value(row: ReportRow, key: string)}
	{#if row.marks?.[key]}<Badge tone={row.marks[key].tone}>{row.marks[key].label}</Badge>{:else}{row
			.values[key]}{/if}
{/snippet}

<!-- eslint-disable svelte/no-navigation-without-resolve -- caller supplies resolved URLs -->
<nav aria-label="Vistas del reporte" class="flex flex-wrap gap-1 border-b border-border">
	{#each views as tab (tab.id)}
		<a
			href={reportHref(base, params, tab.id)}
			aria-current={view === tab.id ? 'page' : undefined}
			class="inline-flex min-h-touch items-center border-b-4 px-3 text-label text-primary-text {view ===
			tab.id
				? 'border-accent font-semibold'
				: 'border-transparent hover:bg-surface-hover'}">{tab.label}</a
		>
	{/each}
</nav>

<section aria-labelledby="report-title" class="min-w-0 space-y-4">
	<div class="flex min-w-0 flex-wrap items-start justify-between gap-3">
		<h2 id="report-title" class="min-w-0 text-heading-2">{title}</h2>
		{#if report}<ExportLinks {campaignId} {report} {params} show={canExport} />{/if}
	</div>
	{#if totals.length}
		<dl
			class="grid gap-x-8 divide-y divide-border border-y border-border bg-surface px-4 sm:grid-cols-2"
			aria-label="Totales del reporte"
		>
			{#each totals as total, i (total.label)}
				<div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
					<dt class="text-body-sm text-muted">{total.label}</dt>
					<dd
						class="m-0 whitespace-nowrap tabular-nums {i === 0
							? 'font-figure text-figure font-bold'
							: 'text-body font-semibold'}"
					>
						{total.value}
					</dd>
				</div>
			{/each}
		</dl>
	{/if}
	<p class="text-body-sm text-muted">
		{rows.length} registros. Página {currentPage} de {lastPage}.
	</p>
	<Table {columns} rows={shown} stack>
		{#snippet cell({ row, column })}
			{#if column.key === '_detail'}
				<Disclosure summary="Ver más datos">
					<dl class="space-y-2">
						{#each extra as field (field.key)}
							<div>
								<dt class="text-body-sm text-muted">{field.label}</dt>
								<dd class="m-0 break-words tabular-nums">{@render value(row, field.key)}</dd>
							</div>
						{/each}
					</dl>
				</Disclosure>
			{:else if column.key === fields[0]?.key && row.bond !== undefined}
				<BondNumber number={row.bond} href={row.href} />
			{:else if column.key === fields[0]?.key && row.href}
				<a
					href={row.href}
					class="inline-flex min-h-touch items-center text-primary-text hover:underline"
					>{@render value(row, column.key)}</a
				>
			{:else}
				<span
					class:whitespace-nowrap={main.find((field) => field.key === column.key)?.numeric}
					class="break-words">{@render value(row, column.key)}</span
				>
			{/if}
		{/snippet}
		{#snippet empty()}<EmptyState title={emptyMessage} />{/snippet}
	</Table>
	{#if lastPage > 1}
		<nav class="flex flex-wrap gap-2" aria-label="Páginas del reporte">
			{#if currentPage > 1}<Button href={reportHref(base, params, view, currentPage - 1)}
					>Anterior</Button
				>{/if}
			{#if currentPage < lastPage}<Button href={reportHref(base, params, view, currentPage + 1)}
					>Siguiente</Button
				>{/if}
		</nav>
	{/if}
</section>

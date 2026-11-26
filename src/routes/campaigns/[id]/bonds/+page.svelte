<script lang="ts">
	import { institutionName } from '$lib/institution';
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import {
		Alert,
		Button,
		Card,
		EmptyState,
		Field,
		PageHeader,
		Select,
		StatusBadge,
		statusMeta,
		Table,
		TextInput,
		type TableColumn
	} from '$lib/components/ui';
	import {
		BOND_COMMERCIAL_STATUSES,
		BOND_FINANCIAL_STATUSES,
		type BondFinancialStatus
	} from '$lib/domain/bonds';
	import { formatMoney, formatNumber } from '$lib/format';
	import type { PageProps } from './$types';

	/**
	 * Bonds list: GET filters (they live in the query string, so the page works without
	 * JavaScript and can be bookmarked), server-side pages, quick actions and a link to each record.
	 */
	let { data }: PageProps = $props();

	const campaign = $derived(data.campaign);
	const values = $derived(data.query.values);
	const errors = $derived(data.query.errors);
	const pagination = $derived(data.pagination);
	const listHref = $derived(resolve('/campaigns/[id]/bonds', { id: campaign.id }));
	const firstRow = $derived((pagination.page - 1) * pagination.pageSize + 1);
	const lastRow = $derived(Math.min(pagination.total, pagination.page * pagination.pageSize));
	const showing = $derived(
		`Mostrando ${formatNumber(firstRow)}–${formatNumber(lastRow)} de ` +
			`${formatNumber(pagination.total)} ${pagination.total === 1 ? 'bono' : 'bonos'}`
	);

	/**
	 * This list at another page, keeping the filters. The pathname is `resolve()`d; only a search
	 * string is appended, which `ResolvedPathname` does not model (hence the cast).
	 */
	function pageLink(page: number): ResolvedPathname {
		const pairs = Object.entries(values).filter(([, value]) => value);
		if (page > 1) pairs.push(['page', String(page)]);
		const search = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
		return (search ? `${listHref}?${search}` : listHref) as ResolvedPathname;
	}
	const recordHref = (bondId: string) =>
		resolve('/campaigns/[id]/bonds/[bondId]', { id: campaign.id, bondId });

	type BondRow = (typeof data.bonds)[number] & Record<string, unknown>;
	const columns: TableColumn<BondRow>[] = [
		{ key: 'base', header: 'Número base' },
		{ key: 'associated', header: 'Número asociado' },
		{ key: 'type', header: 'Tipo' },
		{ key: 'codes', header: 'Códigos' },
		{ key: 'status', header: 'Estado comercial' },
		{ key: 'financial', header: 'Estado financiero' },
		{ key: 'value', header: 'Valor', align: 'right' },
		{ key: 'record', header: 'Ficha', align: 'right' }
	];
	const rows = $derived(data.bonds as BondRow[]);
	const anyOption = [{ value: '', label: 'Cualquiera' }];
	const typeOptions = [
		...anyOption,
		{ value: 'simple', label: 'Bono simple' },
		{ value: 'pata', label: 'Pata' }
	];
	const statusOptions = [
		...anyOption,
		...BOND_COMMERCIAL_STATUSES.map((status) => ({
			value: status,
			label: statusMeta('bondCommercial', status).label
		}))
	];
	const financialOptions = [
		...anyOption,
		...BOND_FINANCIAL_STATUSES.map((status) => ({
			value: status,
			label: statusMeta('bondFinancial', status).label
		}))
	];
	const financialLabel = (status: BondFinancialStatus) => statusMeta('bondFinancial', status).label;
</script>

<svelte:head>
	<title>Bonos - {campaign.name} - {institutionName()}</title>
</svelte:head>

<PageHeader
	title="Bonos"
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: campaign.name, href: resolve('/campaigns/[id]', { id: campaign.id }) },
		{ label: 'Bonos' }
	]}
>
	{#snippet actions()}
		<div class="flex flex-wrap items-center gap-2">
			{#if data.can.create}
				<Button
					variant="primary"
					icon="plus"
					href={resolve('/campaigns/[id]/bonds/new', { id: campaign.id })}>Cargar bono</Button
				>
				<Button href={resolve('/campaigns/[id]/bonds/pata/new', { id: campaign.id })}
					>Cargar pata</Button
				>
			{/if}
			{#if data.can.scan}
				<Button href={resolve('/campaigns/[id]/bonds/scan', { id: campaign.id })}
					>Escanear bonos</Button
				>
			{/if}
			{#if data.can.importFile}
				<Button href={resolve('/campaigns/[id]/bonds/import', { id: campaign.id })}
					>Importar archivo</Button
				>
			{/if}
			<Button disabled aria-describedby="assign-action-note">Asignar a cobrador</Button>
			<span id="assign-action-note" class="text-caption text-muted">Fase 6</span>
		</div>
	{/snippet}
</PageHeader>

<div class="flex flex-col gap-6">
	<Card title="Filtros" id="filters">
		<form method="GET" action={listHref} class="flex flex-col gap-5">
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
				<Field label="Número base" id="filter-base" error={errors.base}>
					<TextInput name="base" inputmode="numeric" autocomplete="off" mono value={values.base} />
				</Field>
				<Field label="Número asociado" id="filter-associated" error={errors.associated}>
					<TextInput
						name="associated"
						inputmode="numeric"
						autocomplete="off"
						mono
						value={values.associated}
					/>
				</Field>
				<Field
					label="Código de barras o código interno"
					id="filter-code"
					hint="Coincidencia exacta."
					error={errors.code}
				>
					<TextInput name="code" autocomplete="off" mono value={values.code} />
				</Field>
				<Field label="Tipo" id="filter-type" error={errors.type}>
					<Select name="type" value={values.type} options={typeOptions} />
				</Field>
				<Field label="Estado comercial" id="filter-status" error={errors.status}>
					<Select name="status" value={values.status} options={statusOptions} />
				</Field>
				<Field label="Estado financiero" id="filter-financial" error={errors.financial}>
					<Select name="financial" value={values.financial} options={financialOptions} />
				</Field>
				<Field
					label="Cobrador"
					id="filter-collector"
					hint="Disponible con cobradores y compradores (fase 5)."
				>
					<Select disabled options={anyOption} />
				</Field>
				<Field label="Comprador" id="filter-buyer">
					<Select disabled options={anyOption} />
				</Field>
			</div>
			<div class="flex flex-wrap gap-2">
				<Button type="submit" variant="primary">Aplicar filtros</Button>
				{#if data.filtered}
					<Button href={listHref}>Quitar filtros</Button>
				{/if}
			</div>
		</form>
	</Card>

	<section aria-labelledby="results-title" class="flex flex-col gap-3">
		<h2 id="results-title" class="sr-only">Resultados</h2>
		{#if Object.keys(errors).length > 0}
			<Alert tone="danger">Corregir los filtros marcados para ver los bonos.</Alert>
		{:else if pagination.total === 0}
			<EmptyState
				title={data.filtered ? 'Ningún bono coincide con los filtros' : 'Todavía no hay bonos'}
				icon={data.filtered ? 'search' : 'inbox'}
			>
				{data.filtered
					? 'Probar con otros filtros o quitarlos para ver todos los bonos.'
					: 'Esta campaña todavía no tiene bonos. Cargar un bono, cargar una pata o importar un archivo para empezar.'}
			</EmptyState>
		{:else if data.bonds.length === 0}
			<EmptyState title="No hay bonos en esta página" icon="search">
				<a href={pageLink(1)} class="text-primary-text underline-offset-2 hover:underline"
					>Ir a la primera página</a
				>
			</EmptyState>
		{:else}
			<p class="m-0 text-body-sm text-muted" aria-live="polite">{showing}</p>
			<Table {columns} {rows} caption="Bonos de la campaña" density="compact">
				{#snippet cell({ row, column })}
					{#if column.key === 'base'}
						<span class="font-mono font-semibold tabular-nums" data-bond-id={row.id}
							>{row.baseFormatted.join(' + ') || '—'}</span
						>
					{:else if column.key === 'associated'}
						<span class="font-mono tabular-nums text-muted"
							>{row.associatedFormatted.join(' + ') || '—'}</span
						>
					{:else if column.key === 'type'}
						{row.typeLabel}{#if row.kind === 'pata'}
							<span class="text-muted"> ({row.unitCount})</span>{/if}
						{#if row.inPata}
							<div class="text-caption text-muted">
								En la pata
								<a
									href={recordHref(row.inPata.pataId)}
									class="font-mono text-primary-text underline-offset-2 hover:underline"
									>{row.inPata.label}</a
								>
							</div>
						{/if}
					{:else if column.key === 'codes'}
						<div class="text-caption">
							{#if row.barcode}<div>
									Código de barras <span class="font-mono">{row.barcode}</span>
								</div>{/if}
							{#if row.internalCode}<div>
									Interno <span class="font-mono">{row.internalCode}</span>
								</div>{/if}
							{#if !row.barcode && !row.internalCode}—{/if}
						</div>
					{:else if column.key === 'status'}
						<StatusBadge kind="bondCommercial" status={row.commercialStatus} />
					{:else if column.key === 'financial'}
						{financialLabel(row.financialStatus)}
					{:else if column.key === 'value'}
						<span class="whitespace-nowrap tabular-nums">{formatMoney(row.totalValue)}</span>
					{:else if column.key === 'record'}
						<a
							href={recordHref(row.id)}
							class="font-medium text-primary-text underline-offset-2 hover:underline"
							>Ver ficha<span class="sr-only"> del bono {row.baseFormatted.join(' + ')}</span></a
						>
					{/if}
				{/snippet}
			</Table>
		{/if}

		{#if pagination.pageCount > 1 || pagination.page > 1}
			<nav aria-label="Paginación" class="flex items-center justify-between gap-3 text-body-sm">
				{#if pagination.page > 1}
					<Button href={pageLink(pagination.page - 1)} rel="prev">← Anterior</Button>
				{:else}
					<span></span>
				{/if}
				<span class="text-muted tabular-nums"
					>Página {formatNumber(pagination.page)} de {formatNumber(pagination.pageCount)}</span
				>
				{#if pagination.page < pagination.pageCount}
					<Button href={pageLink(pagination.page + 1)} rel="next">Siguiente →</Button>
				{:else}
					<span></span>
				{/if}
			</nav>
		{/if}
	</section>
</div>

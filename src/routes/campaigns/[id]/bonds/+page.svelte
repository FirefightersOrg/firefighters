<script lang="ts">
	import { institutionName } from '$lib/institution';
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import {
		Alert,
		BondNumber,
		Button,
		EmptyState,
		Field,
		FilterBar,
		PageHeader,
		Pagination,
		Select,
		StatusBadge,
		statusMeta,
		Table,
		TextInput,
		type AppliedFilter,
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
	 * Bonds list (UX plan PR 9, audit A7): the number first, the other filters folded, and each row
	 * says who has the bond or who bought it. GET filters (they live in the query string, so the page
	 * works without JavaScript and can be bookmarked), server-side pages. Below 720px each row is a
	 * block of two lines instead of a strip of columns.
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
		{ key: 'base', header: 'Número', stack: 'primary' },
		{ key: 'status', header: 'Estado', stack: 'trailing' },
		{ key: 'who', header: 'Quién lo tiene', stack: 'secondary' },
		{ key: 'associated', header: 'Número asociado', stack: 'hidden' },
		{ key: 'type', header: 'Tipo', stack: 'hidden' },
		{ key: 'financial', header: 'Pagos', stack: 'hidden' },
		{ key: 'codes', header: 'Códigos', stack: 'hidden' },
		{ key: 'value', header: 'Valor', align: 'right', stack: 'hidden' }
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

	/** Who has the bond, in words. Empty when nobody does, or when the role cannot read the name. */
	const who = (row: BondRow) => {
		if (row.commercialStatus === 'sold') {
			const sold = row.buyerName ? `Vendido a ${row.buyerName}` : '';
			const collects = row.collectorName ? `lo cobra ${row.collectorName}` : '';
			return [sold, collects]
				.filter(Boolean)
				.join(', ')
				.replace(/^lo cobra/, 'Lo cobra');
		}
		if (row.commercialStatus === 'delivered_to_collector')
			return row.collectorName ? `Lo tiene ${row.collectorName}` : '';
		if (row.commercialStatus === 'lost')
			return row.collectorName ? `Lo tenía ${row.collectorName}` : '';
		return '';
	};

	/** The folded filters that are applied, as chips; each links to the list without it. */
	const FILTER_LABELS = {
		associated: 'Número asociado',
		code: 'Código',
		type: 'Tipo',
		status: 'Estado',
		financial: 'Pagos'
	} as const;
	const optionLabel = (options: { value: string; label: string }[], value: string) =>
		options.find((option) => option.value === value)?.label ?? value;
	function without(key: string): ResolvedPathname {
		const search = Object.entries(values)
			.filter(([name, value]) => value && name !== key)
			.map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
			.join('&');
		return (search ? `${listHref}?${search}` : listHref) as ResolvedPathname;
	}
	const applied = $derived<AppliedFilter[]>(
		(Object.keys(FILTER_LABELS) as (keyof typeof FILTER_LABELS)[])
			.filter((key) => values[key])
			.map((key) => ({
				label: `${FILTER_LABELS[key]}: ${
					key === 'type'
						? optionLabel(typeOptions, values.type)
						: key === 'status'
							? optionLabel(statusOptions, values.status)
							: key === 'financial'
								? optionLabel(financialOptions, values.financial)
								: values[key]
				}`,
				removeHref: without(key)
			}))
	);
	const foldedError = $derived(
		(Object.keys(FILTER_LABELS) as (keyof typeof FILTER_LABELS)[]).some((key) => errors[key])
	);
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
		</div>
	{/snippet}
</PageHeader>

<div class="flex flex-col gap-6">
	<div id="filters">
		<FilterBar
			action={listHref}
			searchName="base"
			searchLabel="Número de bono"
			searchValue={values.base}
			searchError={errors.base}
			inputmode="numeric"
			{applied}
			clearHref={data.filtered ? listHref : undefined}
			open={foldedError}
		>
			{#snippet filters()}
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
					<Field label="Estado" id="filter-status" error={errors.status}>
						<Select name="status" value={values.status} options={statusOptions} />
					</Field>
					<Field label="Pagos" id="filter-financial" error={errors.financial}>
						<Select name="financial" value={values.financial} options={financialOptions} />
					</Field>
				</div>
			{/snippet}
		</FilterBar>
	</div>

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
			<Table {columns} {rows} caption="Bonos de la campaña" density="compact" stack>
				{#snippet cell({ row, column })}
					{#if column.key === 'base'}
						<span data-bond-id={row.id} class="inline-flex items-baseline gap-2">
							{#if row.baseFormatted.length}
								<BondNumber
									number={row.baseFormatted.join(' + ')}
									size="sm"
									href={recordHref(row.id)}
								/>
							{:else}
								<a
									href={recordHref(row.id)}
									class="font-medium text-primary-text underline underline-offset-2">Ver ficha</a
								>
							{/if}
							{#if row.kind === 'pata'}
								<span class="text-caption text-muted min-[720px]:hidden">pata</span>
							{/if}
						</span>
					{:else if column.key === 'who'}
						{who(row) || '—'}
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
					{/if}
				{/snippet}
			</Table>
		{/if}

		<Pagination page={pagination.page} pageCount={pagination.pageCount} hrefFor={pageLink} />
	</section>
</div>

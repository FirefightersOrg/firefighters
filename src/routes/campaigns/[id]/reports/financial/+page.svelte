<script lang="ts">
	import { institutionName } from '$lib/institution';
	import { resolve } from '$app/paths';
	import Button from '$lib/components/ui/Button.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import TextInput from '$lib/components/ui/TextInput.svelte';
	import { PageHeader, Disclosure } from '$lib/components/ui';
	import ReportView from '$lib/components/reports/ReportView.svelte';
	import { financialModel, settlementLabels } from '$lib/components/reports/models';
	import { FINANCIAL_VIEWS, reportHref } from '$lib/report-views';
	import {
		PAYMENT_METHODS,
		SETTLEMENT_STATUSES,
		ROSTER_ELIGIBILITY_FILTERS
	} from '$lib/domain/financial-reports';
	import { PAYMENT_METHOD_LABELS } from '$lib/domain/payments';
	import { PRIZE_STATUSES, PRIZE_STATUS_LABELS } from '$lib/domain/prizes';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const campaign = $derived(data.campaign);
	const filters = $derived(data.filters);
	const exportParams = $derived({
		collector: filters.collectorId,
		method: filters.method,
		settlement: filters.settlementStatus,
		from: filters.from,
		to: filters.to,
		draw: filters.drawId,
		eligibility: filters.eligibility,
		prize: filters.prizeStatus
	});
	const withAll = (options: { value: string; label: string }[], all = 'Todos') => [
		{ value: '', label: all },
		...options
	];
	const collectorOptions = $derived(
		withAll([
			...data.collectors.map((c) => ({ value: c.id, label: c.displayName })),
			...(filters.collectorId && !data.collectors.some((c) => c.id === filters.collectorId)
				? [{ value: filters.collectorId, label: 'Cobrador seleccionado' }]
				: [])
		])
	);
	const methodOptions = withAll(
		PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))
	);
	const settlementOptions = withAll(
		SETTLEMENT_STATUSES.map((v) => ({
			value: v,
			label: settlementLabels[v]
		}))
	);
	const drawOptions = $derived(
		withAll(data.draws.map((d) => ({ value: d.drawId, label: d.drawName })))
	);
	const eligibilityOptions = withAll(
		ROSTER_ELIGIBILITY_FILTERS.map((e) => ({
			value: e,
			label: e === 'eligible' ? 'Solo elegibles' : 'Solo no elegibles'
		})),
		'Elegibles y no elegibles'
	);
	const prizeOptions = withAll(
		PRIZE_STATUSES.map((v) => ({ value: v, label: PRIZE_STATUS_LABELS[v] }))
	);

	const base = $derived(resolve('/campaigns/[id]/reports/financial', { id: campaign.id }));
	const view = $derived(data.view ?? 'payments');
	const model = $derived(
		financialModel(data, view, (target, overrides) =>
			reportHref(base, { ...exportParams, ...overrides }, target)
		)
	);
</script>

<svelte:head
	><title>Reportes financieros - {campaign.name} - {institutionName()}</title></svelte:head
>
<PageHeader
	title="Reportes financieros y de sorteos"
	description="Pagos, rendiciones, cuentas y padrones. Sin pagos en borrador ni anulados. Fechas de Buenos Aires."
	breadcrumbs={[
		{ label: 'Reportes operativos', href: resolve('/campaigns/[id]/reports', { id: campaign.id }) },
		{ label: 'Reportes financieros' }
	]}
/>
<div class="min-w-0 space-y-4">
	<Disclosure summary="Filtrar reportes">
		<form method="GET" class="grid gap-3 sm:grid-cols-3 sm:items-end">
			<input type="hidden" name="view" value={view} />
			<Field label="Cobrador" id="collector">
				<Select name="collector" options={collectorOptions} value={filters.collectorId ?? ''} />
			</Field>
			<Field label="Medio de pago" id="method">
				<Select name="method" options={methodOptions} value={filters.method ?? ''} />
			</Field>
			<Field label="Estado de la rendición" id="settlement">
				<Select
					name="settlement"
					options={settlementOptions}
					value={filters.settlementStatus ?? ''}
				/>
			</Field>
			<Field label="Desde (pagos, rendiciones, cuenta)" id="from">
				<TextInput name="from" type="date" value={filters.from ?? ''} />
			</Field>
			<Field label="Hasta" id="to">
				<TextInput name="to" type="date" value={filters.to ?? ''} />
			</Field>
			<Field label="Sorteo (padrón y premios)" id="draw">
				<Select name="draw" options={drawOptions} value={filters.drawId ?? ''} />
			</Field>
			<Field label="Números del padrón" id="eligibility">
				<Select name="eligibility" options={eligibilityOptions} value={filters.eligibility ?? ''} />
			</Field>
			<Field label="Estado del premio" id="prize">
				<Select name="prize" options={prizeOptions} value={filters.prizeStatus ?? ''} />
			</Field>
			<div class="flex gap-2">
				<Button type="submit" variant="primary">Aplicar</Button>
				<Button href={reportHref(base, {}, view)}>Limpiar</Button>
			</div>
		</form>
	</Disclosure>
	<ReportView
		campaignId={campaign.id}
		{base}
		params={exportParams}
		views={FINANCIAL_VIEWS}
		{view}
		page={data.page ?? 1}
		{...model}
		canExport={data.canExport}
	/>
	{#if view === 'roster' && data.rosterTruncated}<p class="text-body-sm text-muted">
			Se muestran los primeros {data.roster?.length} números, paginados. La exportación tiene todos.
		</p>{/if}
</div>

<script lang="ts">
	import { institutionName } from '$lib/institution';
	import { resolve } from '$app/paths';
	import Button from '$lib/components/ui/Button.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import { PageHeader, Disclosure } from '$lib/components/ui';
	import ReportView from '$lib/components/reports/ReportView.svelte';
	import { operationalModel } from '$lib/components/reports/models';
	import { OPERATIONAL_VIEWS, reportHref } from '$lib/report-views';
	import Select from '$lib/components/ui/Select.svelte';
	import TextInput from '$lib/components/ui/TextInput.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import {
		BOND_COMMERCIAL_STATUSES,
		BOND_COMMERCIAL_STATUS_LABELS,
		BOND_FINANCIAL_STATUSES,
		BOND_FINANCIAL_STATUS_LABELS,
		BOND_KIND_LABELS,
		BOND_KINDS
	} from '$lib/domain/bonds';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const overdue = $derived(data.overdueWarning);
	const thresholdForm = $derived(
		form?.form === 'setOverdueThreshold'
			? (form as {
					success?: boolean;
					message?: string | null;
					fieldError?: string | null;
					threshold?: string;
				})
			: null
	);
	const campaign = $derived(data.campaign);
	const filters = $derived(data.filters);
	const exportParams = $derived({
		collector: filters.collectorId,
		kind: filters.kind,
		status: filters.commercialStatus,
		financial: filters.financialStatus,
		month: filters.month,
		from: filters.from,
		to: filters.to
	});
	const withAll = (options: { value: string; label: string }[]) => [
		{ value: '', label: 'Todos' },
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
	const kindOptions = withAll(BOND_KINDS.map((k) => ({ value: k, label: BOND_KIND_LABELS[k] })));
	const commercialOptions = withAll(
		BOND_COMMERCIAL_STATUSES.map((s) => ({ value: s, label: BOND_COMMERCIAL_STATUS_LABELS[s] }))
	);
	const financialOptions = withAll(
		BOND_FINANCIAL_STATUSES.map((s) => ({ value: s, label: BOND_FINANCIAL_STATUS_LABELS[s] }))
	);

	const base = $derived(resolve('/campaigns/[id]/reports', { id: campaign.id }));
	const view = $derived(thresholdForm ? 'overdue-warning' : (data.view ?? 'by-status'));
	const model = $derived(
		operationalModel(
			data,
			view,
			(collectorId) =>
				data.canViewCollectors
					? resolve('/campaigns/[id]/collectors/[collectorId]', { id: campaign.id, collectorId })
					: undefined,
			(saleId) =>
				overdue.canViewSales
					? resolve('/campaigns/[id]/sales/[saleId]', { id: campaign.id, saleId })
					: undefined
		)
	);
</script>

<svelte:head><title>Reportes operativos - {campaign.name} - {institutionName()}</title></svelte:head
>
<PageHeader
	title="Reportes operativos"
	description="Bonos, cuotas y actividad de los cobradores. Fechas de Buenos Aires."
	breadcrumbs={[
		{ label: campaign.name, href: resolve('/campaigns/[id]', { id: campaign.id }) },
		{ label: 'Reportes' }
	]}
>
	{#snippet actions()}{#if data.canViewFinancial}<Button
				href={resolve('/campaigns/[id]/reports/financial', { id: campaign.id })}
				>Reportes financieros</Button
			>{/if}{/snippet}
</PageHeader>
<div class="min-w-0 space-y-4">
	<Disclosure summary="Filtrar reportes">
		<form method="GET" class="grid gap-3 sm:grid-cols-3 sm:items-end">
			<input type="hidden" name="view" value={view} />
			<Field label="Cobrador" id="collector">
				<Select name="collector" options={collectorOptions} value={filters.collectorId ?? ''} />
			</Field>
			<Field label="Tipo de bono" id="kind">
				<Select name="kind" options={kindOptions} value={filters.kind ?? ''} />
			</Field>
			<Field label="Estado comercial" id="status">
				<Select name="status" options={commercialOptions} value={filters.commercialStatus ?? ''} />
			</Field>
			<Field label="Estado financiero" id="financial">
				<Select name="financial" options={financialOptions} value={filters.financialStatus ?? ''} />
			</Field>
			<Field label="Mes (resumen mensual)" id="month">
				<TextInput name="month" type="month" value={filters.month} />
			</Field>
			<Field label="Cuotas con vencimiento desde" id="from">
				<TextInput name="from" type="date" value={filters.from ?? ''} />
			</Field>
			<Field label="Cuotas con vencimiento hasta" id="to">
				<TextInput name="to" type="date" value={filters.to ?? ''} />
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
		views={OPERATIONAL_VIEWS}
		{view}
		page={data.page ?? 1}
		{...model}
		canExport={data.canExport}
	/>
	{#if view === 'installments'}<p class="text-body-sm text-muted">
			Solo ventas activas. Las vencidas incluyen cuotas pendientes con fecha de vencimiento pasada.
		</p>{/if}
	{#if view === 'monthly'}<p class="text-body-sm text-muted">
			Asignados: bonos que se tienen hoy. Vendidos: ventas del mes. Cuotas: vencen en el mes y
			siguen impagas. Los pagos excluyen borradores y anulados.
		</p>{/if}
	{#if view === 'overdue-warning'}
		<p class="text-body-sm text-muted">
			Aviso informativo: no marca ninguna venta como incobrable. Solo ventas activas que no están
			marcadas como incobrables. Respeta el filtro de cobrador.
		</p>
		{#if thresholdForm?.message}
			<div class="mb-3">
				<Alert tone={thresholdForm.success ? 'success' : 'danger'}>{thresholdForm.message}</Alert>
			</div>
		{/if}
		{#if overdue.canEdit}
			<form
				method="POST"
				action="?/setOverdueThreshold"
				class="mb-4 flex flex-wrap items-end gap-3"
			>
				<Field
					label="Avisar desde (cuotas vencidas)"
					id="overdue-threshold"
					hint="Entre 1 y 120. Vale para toda la campaña."
					error={thresholdForm?.fieldError ?? undefined}
				>
					<TextInput
						name="threshold"
						inputmode="numeric"
						autocomplete="off"
						value={thresholdForm && !thresholdForm.success
							? (thresholdForm.threshold ?? '')
							: String(overdue.threshold)}
					/>
				</Field>
				<Button type="submit">Guardar</Button>
			</form>
		{/if}
	{/if}
</div>

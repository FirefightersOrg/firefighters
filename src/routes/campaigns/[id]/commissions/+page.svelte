<script lang="ts">
	import { institutionName } from '$lib/institution';
	import { resolve } from '$app/paths';
	import AnnulRuleAction from '$lib/components/commissions/AnnulRuleAction.svelte';
	import CommissionRuleForm from '$lib/components/commissions/CommissionRuleForm.svelte';
	import {
		Alert,
		Badge,
		Button,
		Disclosure,
		EmptyState,
		PageHeader,
		StatusBadge,
		Table,
		statusMeta,
		type Tone,
		type TableColumn
	} from '$lib/components/ui';
	import {
		commissionRuleTiming,
		describeCommissionRuleType,
		describeCommissionValue,
		describeValidity,
		type CommissionRule,
		type CommissionRuleTiming
	} from '$lib/domain/commissions';
	import { formatMoney } from '$lib/format';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const campaign = $derived(data.campaign);
	const listHref = $derived(resolve('/campaigns/[id]/commissions', { id: campaign.id }));

	// Edit mode: `?edit=<id>`, or a failed edit submitted without JavaScript (the action URL drops
	// the `edit` parameter, so the failed result says which rule was being edited).
	const editRuleId = $derived(
		form?.form === 'update' && !form.success && form.ruleId ? form.ruleId : data.editRuleId
	);
	const editRule = $derived(
		data.can.manage && editRuleId
			? ([...data.rules, ...data.specialRules].find(
					(r) => r.id === editRuleId && r.status === 'active'
				) ?? null)
			: null
	);
	const ruleFormResult = $derived(
		form && (form.form === 'create' || form.form === 'update') ? form : null
	);
	// The create/edit form only shows results that belong to it: a failed edit stays in the edit
	// form; a successful edit is shown on the create form (edit mode was left).
	const formResult = $derived.by(() => {
		if (!ruleFormResult) return null;
		if (editRule) {
			return ruleFormResult.form === 'update' &&
				!ruleFormResult.success &&
				ruleFormResult.ruleId === editRule.id
				? ruleFormResult
				: null;
		}
		return ruleFormResult.form === 'create' || ruleFormResult.success ? ruleFormResult : null;
	});
	const annulResult = $derived(form?.form === 'annul' ? form : null);
	const annulMessage = $derived(
		Object.values(annulResult?.errors ?? {}).flat()[0] ?? annulResult?.message
	);

	const TIMING_LABELS: Record<CommissionRuleTiming, { label: string; tone: Tone }> = {
		current: { label: 'Vigente', tone: 'success' },
		upcoming: { label: 'Próxima', tone: 'info' },
		ended: { label: 'Finalizada', tone: 'neutral' }
	};

	type RuleRow = {
		id: string;
		rule: CommissionRule;
		collector: string;
		type: string;
		commission: string;
		validity: string;
		annulled: boolean;
		timing: CommissionRuleTiming;
	};
	function toRow(rule: CommissionRule & { collectorName?: string }): RuleRow {
		return {
			id: rule.id,
			rule,
			collector: rule.collectorName ?? '',
			type: describeCommissionRuleType(rule),
			commission:
				rule.fixedAmount === null
					? describeCommissionValue(rule)
					: formatMoney(Math.round(Number(rule.fixedAmount))),
			validity: describeValidity(rule),
			annulled: rule.status === 'annulled',
			timing: commissionRuleTiming(rule, data.today)
		};
	}
	const generalRows = $derived(data.rules.map(toRow));
	const specialRows = $derived(data.specialRules.map(toRow));

	const actionsColumn = $derived<TableColumn<RuleRow>[]>(
		data.can.manage ? [{ key: 'actions', header: 'Acciones', align: 'right' }] : []
	);
	const generalColumns = $derived<TableColumn<RuleRow>[]>([
		{ key: 'type', header: 'Tipo', stack: 'primary' },
		{ key: 'commission', header: 'Comisión', align: 'right', stack: 'trailing' },
		{ key: 'validity', header: 'Vigencia' },
		{ key: 'status', header: 'Estado' },
		...actionsColumn
	]);
	const specialColumns = $derived<TableColumn<RuleRow>[]>([
		{ key: 'collector', header: 'Cobrador', stack: 'secondary' },
		...generalColumns
	]);
	const statusLabel = $derived(statusMeta('campaign', campaign.status).label.toLowerCase());
</script>

<svelte:head>
	<title>Reglas de comisión - {campaign.name} - {institutionName()}</title>
</svelte:head>

{#snippet ruleCell(row: RuleRow, column: TableColumn<RuleRow>)}
	{#if column.key === 'type' || column.key === 'collector'}
		<span id="rule-{row.id}" class={row.annulled ? 'text-muted' : 'text-text'}>
			{row[column.key]}
		</span>
	{:else if column.key === 'commission'}
		<span class={row.annulled ? 'line-through' : ''}>{row.commission}</span>
	{:else if column.key === 'validity'}
		<span class="whitespace-nowrap">{row.validity}</span>
	{:else if column.key === 'status'}
		{#if row.annulled}
			<StatusBadge kind="commissionRule" status="annulled" />
			{#if row.rule.annulReason}
				<p class="m-0 mt-1 max-w-xs text-caption break-words text-muted">{row.rule.annulReason}</p>
			{/if}
		{:else}
			<Badge tone={TIMING_LABELS[row.timing].tone}>{TIMING_LABELS[row.timing].label}</Badge>
		{/if}
	{:else if column.key === 'actions'}
		{#if !row.annulled}
			<div class="flex justify-end gap-2">
				<Button
					variant="ghost"
					size="sm"
					href="{listHref}?edit={row.id}#edit-rule-title"
					aria-label={row.collector
						? `Editar regla especial de ${row.collector}`
						: `Editar regla: ${row.type}, ${row.validity}`}>Editar</Button
				>
				<AnnulRuleAction
					ruleId={row.id}
					description={row.collector
						? `${row.collector}: ${row.type}, ${row.commission}`
						: `${row.type}, ${row.commission}, ${row.validity}`}
				/>
			</div>
		{/if}
	{/if}
{/snippet}

<PageHeader
	title="Reglas de comisión"
	description="Las reglas generales se aplican a todos los cobradores de esta campaña. Las reglas especiales por cobrador tienen prioridad."
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: campaign.name, href: resolve('/campaigns/[id]', { id: campaign.id }) },
		{ label: 'Reglas de comisión' }
	]}
>
	{#snippet actions()}
		<StatusBadge kind="campaign" status={campaign.status} />
	{/snippet}
</PageHeader>

<div class="flex flex-col gap-6">
	{#if ruleFormResult?.success}
		<Alert tone="success">{ruleFormResult.message}</Alert>
	{/if}
	{#if annulResult}
		<Alert tone={annulResult.success ? 'success' : 'danger'}>{annulMessage}</Alert>
	{/if}
	{#if data.editNotFound}
		<Alert tone="warning">
			Esa regla no se puede editar: no existe en esta campaña o fue anulada.
		</Alert>
	{/if}
	{#if campaign.status !== 'draft' && campaign.status !== 'active'}
		<Alert tone="warning">
			<strong>Solo lectura.</strong> Esta campaña está {statusLabel}; las reglas de comisión solo se
			pueden cambiar mientras la campaña es un borrador o está activa.
		</Alert>
	{/if}

	<section id="rules" class="space-y-3">
		<h2 class="text-heading-2">Reglas generales</h2>
		<Table stack columns={generalColumns} rows={generalRows} selectedKey={editRule?.id}>
			{#snippet cell({ row, column })}
				{@render ruleCell(row, column)}
			{/snippet}
			{#snippet empty()}
				<EmptyState title="Todavía no hay reglas de comisión" />
			{/snippet}
		</Table>
	</section>

	<section id="special-rules" class="space-y-3">
		<h2 class="text-heading-2">Reglas especiales por cobrador</h2>
		<p class="text-body-sm text-muted">
			Una regla especial tiene prioridad sobre las reglas generales para ese cobrador.
		</p>
		<Table stack columns={specialColumns} rows={specialRows} selectedKey={editRule?.id}>
			{#snippet cell({ row, column })}
				{@render ruleCell(row, column)}
			{/snippet}
			{#snippet empty()}
				<EmptyState title="No hay reglas especiales por cobrador" />
			{/snippet}
		</Table>
	</section>

	{#if data.can.manage}
		<!-- Re-mount when switching between create and edit, between rules, or when a load brings a
		     new version of the edited rule: its values and version must come from the same load. -->
		{#key editRule ? `${editRule.id}@${editRule.updatedAt}` : 'new'}
			<Disclosure
				summary={editRule ? 'Editar regla' : 'Agregar una regla'}
				defaultOpen={!!editRule || !!(formResult && !formResult.success)}
			>
				<CommissionRuleForm
					rule={editRule}
					installmentCount={campaign.installmentCount}
					result={formResult?.success ? null : formResult}
					campaignId={campaign.id}
					collectors={data.collectors}
				/>
			</Disclosure>
		{/key}
	{:else if campaign.status === 'draft' || campaign.status === 'active'}
		<p class="m-0 text-body-sm text-muted">
			Solo quienes tienen permiso para gestionar reglas de comisión pueden cambiarlas.
		</p>
	{/if}
</div>

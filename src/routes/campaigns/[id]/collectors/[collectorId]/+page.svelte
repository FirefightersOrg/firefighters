<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import CollectorForm from '$lib/components/collectors/CollectorForm.svelte';
	import {
		Alert,
		Button,
		Checkbox,
		EmptyState,
		Field,
		PageHeader,
		Section,
		Select,
		Stat,
		StatusBadge,
		Table
	} from '$lib/components/ui';
	import type { TableColumn } from '$lib/components/ui';
	import { deliveryNoteLabel } from '$lib/domain/deliveries';
	import { campaignNumberingConfig } from '$lib/domain/campaigns';
	import { formatCampaignNumber } from '$lib/domain/numbering';
	import { COLLECTOR_STATUS_LABELS } from '$lib/domain/parties';
	import {
		describeCommissionRuleType,
		describeCommissionValue,
		describeValidity
	} from '$lib/domain/commissions';
	import { formatDate, formatDateTime, formatMoney, formatNumber } from '$lib/format';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const numbering = $derived(campaignNumberingConfig(data.campaign));
	/** "0068 / 4939" for a simple bond, "Pata 0100, 0101" for a pata. */
	function bondLabel(bond: { kind: string; baseNumbers: number[]; associatedNumbers: number[] }) {
		const fmt = (numbers: number[]) =>
			numbers.map((n) => formatCampaignNumber(n, numbering)).join(', ');
		return bond.kind === 'simple'
			? `${fmt(bond.baseNumbers)} / ${fmt(bond.associatedNumbers)}`
			: `Pata ${fmt(bond.baseNumbers)}`;
	}
	const sections = [
		'Datos generales',
		'Bonos asignados',
		'Compradores asociados',
		'Cuotas pendientes',
		'Rendiciones',
		'Cuenta corriente',
		'Informe mensual',
		'Auditoría'
	];
	const canBulk = $derived(data.custody.can.returnBonds || data.custody.can.reassignBonds);
	/** A bulk return / reassignment result (its errors belong to section 2, not the edit form). */
	const custodyForm = $derived(
		form && 'form' in form && form.form === 'custody'
			? (form as { message?: string; errors?: Record<string, string[]> })
			: null
	);
	const collectorForm = $derived(
		custodyForm
			? null
			: ((form ?? null) as {
					success?: boolean;
					message?: string;
					values?: Record<string, string>;
					errors?: Record<string, string[]>;
				} | null)
	);
	const dash = (value: string | null) => value ?? '—';

	type BondRow = (typeof data.bonds)[number] & Record<string, unknown>;
	const bondColumns = $derived<TableColumn<BondRow>[]>([
		...(canBulk ? [{ key: 'select', header: 'Seleccionar', width: '6rem' }] : []),
		{ key: 'bond', header: 'Bono', mono: true },
		{ key: 'status', header: 'Estado' },
		{ key: 'note', header: 'Remito de entrega' }
	]);

	const installmentRows = $derived(
		(data.installments ?? []).map((installment) => ({
			id: installment.id,
			saleId: installment.saleId,
			bonds: installment.bondNumbers.join(', '),
			buyer: installment.buyerName,
			dueDate: formatDate(installment.dueDate),
			amount: formatMoney(installment.amount, { decimals: 'always' }),
			status: installment.status
		}))
	);
	type InstallmentRow = (typeof installmentRows)[number];
	const installmentColumns: TableColumn<InstallmentRow>[] = [
		{ key: 'bonds', header: 'Bono', mono: true },
		{ key: 'buyer', header: 'Comprador' },
		{ key: 'dueDate', header: 'Vencimiento' },
		{ key: 'amount', header: 'Monto', align: 'right' },
		{ key: 'status', header: 'Estado' }
	];

	const settlementRows = $derived(
		(data.settlements ?? []).map((settlement) => ({
			id: settlement.id,
			number: `#${settlement.settlementNumber}`,
			status: settlement.status,
			total: formatMoney(settlement.totals.totalAmount, { decimals: 'always' }),
			dates: `${formatDate(settlement.openedAt)}${
				settlement.closedAt ? ` – ${formatDate(settlement.closedAt)}` : ''
			}`
		}))
	);
	type SettlementRow = (typeof settlementRows)[number];
	const settlementColumns: TableColumn<SettlementRow>[] = [
		{ key: 'number', header: 'Número' },
		{ key: 'status', header: 'Estado' },
		{ key: 'total', header: 'Total', align: 'right' },
		{ key: 'dates', header: 'Fechas' }
	];

	const ruleRows = $derived(
		data.specialRules.map((rule) => ({
			id: rule.id,
			type: describeCommissionRuleType(rule),
			commission: describeCommissionValue(rule),
			validity: describeValidity(rule),
			status: rule.status
		}))
	);
	type RuleRow = (typeof ruleRows)[number];
	const ruleColumns: TableColumn<RuleRow>[] = [
		{ key: 'type', header: 'Tipo' },
		{ key: 'commission', header: 'Comisión', align: 'right' },
		{ key: 'validity', header: 'Vigencia' },
		{ key: 'status', header: 'Estado' }
	];
	const listHref = $derived(resolve('/campaigns/[id]/collectors', { id: data.campaign.id }));
</script>

<svelte:head
	><title>{data.collector.displayName} - {data.campaign.name} - Firefighters</title></svelte:head
>

<PageHeader
	title={data.collector.displayName}
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: data.campaign.name, href: resolve('/campaigns/[id]', { id: data.campaign.id }) },
		{ label: 'Cobradores', href: listHref },
		{ label: data.collector.displayName }
	]}
>
	{#snippet actions()}
		<StatusBadge kind="collector" status={data.collector.status} />
	{/snippet}
</PageHeader>

{#if data.can.viewReports}
	<p class="mb-4 text-body-sm">
		<a
			href="{resolve('/campaigns/[id]/reports', { id: data.campaign.id })}?collector={data.collector
				.id}#monthly-title">Resumen operativo mensual →</a
		>
	</p>
{/if}

<nav aria-label="Secciones del registro" class="mb-6">
	<ol class="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-body-sm">
		{#each sections as section, i (section)}
			<li>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- in-page anchor -->
				<a
					href="#section-{i + 1}"
					class="rounded-sm text-primary-text underline-offset-2 hover:underline"
					>{i + 1}. {section}</a
				>
			</li>
		{/each}
	</ol>
</nav>

<div class="flex flex-col gap-6">
	<Section id="section-1" number={1} title={sections[0]}>
		{#if data.can.manage}
			<CollectorForm
				collector={data.collector}
				profiles={data.profiles}
				form={collectorForm}
				action="?/update"
				submitLabel="Guardar cambios"
			/>
		{:else}
			<dl class="m-0 grid gap-4 sm:grid-cols-2">
				<div>
					<dt class="text-label text-muted">Teléfono</dt>
					<dd class="m-0">{dash(data.collector.phone)}</dd>
				</div>
				<div>
					<dt class="text-label text-muted">Correo electrónico</dt>
					<dd class="m-0">{dash(data.collector.email)}</dd>
				</div>
				<div>
					<dt class="text-label text-muted">Domicilio</dt>
					<dd class="m-0">{dash(data.collector.address)}</dd>
				</div>
				<div>
					<dt class="text-label text-muted">Estado</dt>
					<dd class="m-0">{COLLECTOR_STATUS_LABELS[data.collector.status]}</dd>
				</div>
			</dl>
		{/if}
	</Section>

	<Section id="section-2" number={2} title={sections[1]}>
		{#if custodyForm?.message}
			<div class="mb-4"><Alert tone="danger">{custodyForm.message}</Alert></div>
		{/if}
		{#if data.bonds.length === 0}
			<EmptyState title="No hay bonos asignados en esta campaña" />
		{:else}
			<p class="m-0 mb-3 text-body-sm text-muted">
				{formatNumber(data.bondsTotal)}
				{data.bondsTotal === 1 ? 'bono' : 'bonos'}{data.bondsTotal > data.bonds.length
					? ` (se muestran los primeros ${formatNumber(data.bonds.length)})`
					: ''}
			</p>
			<form method="POST" use:enhance class="flex flex-col gap-4">
				<Table columns={bondColumns} rows={data.bonds as BondRow[]} caption="Bonos asignados">
					{#snippet cell({ row, column })}
						{#if column.key === 'select'}
							{#if row.commercialStatus === 'delivered_to_collector'}
								<Checkbox name="bondIds" value={row.id} aria-label="Seleccionar {bondLabel(row)}" />
							{/if}
						{:else if column.key === 'bond'}
							<a
								class="rounded-sm text-primary-text underline-offset-2 hover:underline"
								href={resolve('/campaigns/[id]/bonds/[bondId]', {
									id: data.campaign.id,
									bondId: row.id
								})}>{bondLabel(row)}</a
							>
						{:else if column.key === 'status'}
							<StatusBadge kind="bondCommercial" status={row.commercialStatus} />
						{:else if row.note}
							<a
								class="rounded-sm text-primary-text underline-offset-2 hover:underline"
								href={resolve('/campaigns/[id]/deliveries/[noteId]', {
									id: data.campaign.id,
									noteId: row.note.noteId
								})}>{deliveryNoteLabel(row.note.noteNumber)}</a
							>
						{:else}—{/if}
					{/snippet}
				</Table>
				{#if custodyForm?.errors?.bondIds?.[0]}
					<p class="m-0 text-body-sm text-danger-text" id="bondIds-error">
						{custodyForm.errors.bondIds[0]}
					</p>
				{/if}
				{#if canBulk}
					<div class="flex flex-wrap items-end gap-3">
						{#if data.custody.can.returnBonds}
							<Button type="submit" formaction="?/returnBonds">Devolver seleccionados</Button>
						{/if}
						{#if data.custody.can.reassignBonds}
							<Field
								label="Reasignar seleccionados a"
								id="targetCollectorId"
								error={custodyForm?.errors?.targetCollectorId?.[0]}
							>
								<Select
									name="targetCollectorId"
									options={[
										{ value: '', label: 'Elegir cobrador…' },
										...data.custody.collectors.map((c) => ({ value: c.id, label: c.displayName }))
									]}
								/>
							</Field>
							<Button type="submit" formaction="?/reassignBonds">Reasignar</Button>
						{/if}
					</div>
				{/if}
			</form>
		{/if}
	</Section>

	<Section id="section-3" number={3} title={sections[2]}>
		{#if data.buyers.length === 0}
			<EmptyState title="No hay compradores asociados" />
		{:else}
			<ul class="m-0 flex list-none flex-col gap-1 p-0">
				{#each data.buyers as buyer (buyer.id)}
					<li>
						<!-- eslint-disable svelte/no-navigation-without-resolve -->
						<a
							class="rounded-sm text-primary-text underline-offset-2 hover:underline"
							href={`${resolve('/campaigns/[id]', { id: data.campaign.id })}/buyers/${buyer.id}`}
							>{buyer.businessName ??
								[buyer.lastName, buyer.firstName].filter(Boolean).join(', ')}</a
						>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					</li>
				{/each}
			</ul>
			{#if data.buyersTotal > data.buyers.length}
				<p class="m-0 mt-2 text-body-sm text-muted">
					y {formatNumber(data.buyersTotal - data.buyers.length)} más
				</p>
			{/if}
		{/if}
	</Section>

	<Section id="section-4" number={4} title={sections[3]}>
		<p class="m-0 mb-3 text-body-sm text-muted">
			{formatNumber(data.installmentsTotal ?? 0)}
			{data.installmentsTotal === 1
				? 'cuota pendiente o vencida'
				: 'cuotas pendientes o vencidas'}{(data.installmentsTotal ?? 0) >
			(data.installments ?? []).length
				? ` (se muestran las primeras ${formatNumber((data.installments ?? []).length)})`
				: ''}
		</p>
		<Table columns={installmentColumns} rows={installmentRows} caption="Cuotas pendientes">
			{#snippet cell({ row, column })}
				{#if column.key === 'bonds'}
					<a
						class="rounded-sm text-primary-text underline-offset-2 hover:underline"
						href={resolve('/campaigns/[id]/sales/[saleId]', {
							id: data.campaign.id,
							saleId: row.saleId
						})}>Bono {row.bonds}</a
					>
				{:else if column.key === 'status'}
					<StatusBadge kind="installment" status={row.status} />
				{:else}
					{row[column.key as keyof InstallmentRow]}
				{/if}
			{/snippet}
			{#snippet empty()}
				<EmptyState title="No hay cuotas pendientes" />
			{/snippet}
		</Table>
	</Section>

	<Section id="section-5" number={5} title={sections[4]}>
		<Table columns={settlementColumns} rows={settlementRows} caption="Rendiciones del cobrador">
			{#snippet cell({ row, column })}
				{#if column.key === 'number'}
					<a
						class="rounded-sm text-primary-text underline-offset-2 hover:underline"
						href={resolve('/campaigns/[id]/settlements/[settlementId]', {
							id: data.campaign.id,
							settlementId: row.id
						})}>{row.number}</a
					>
				{:else if column.key === 'status'}
					<StatusBadge kind="settlement" status={row.status} />
				{:else}
					{row[column.key as keyof SettlementRow]}
				{/if}
			{/snippet}
			{#snippet empty()}
				<EmptyState title="No hay rendiciones registradas" />
			{/snippet}
		</Table>
	</Section>

	<Section id="section-6" number={6} title={sections[5]}>
		{#if data.ledger}
			<div class="flex flex-wrap items-center gap-4">
				<div data-testid="collector-balance" class="min-w-48">
					<Stat
						label="Saldo del cobrador"
						value={data.ledger.balance === null
							? '—'
							: formatMoney(data.ledger.balance, { decimals: 'always' })}
					/>
				</div>
				<Button
					href={resolve('/campaigns/[id]/collectors/[collectorId]/ledger', {
						id: data.campaign.id,
						collectorId: data.collector.id
					})}>Ver cuenta corriente</Button
				>
			</div>
		{:else}
			<p class="m-0 text-muted">No hay permiso para ver la cuenta corriente.</p>
		{/if}
		{#if data.can.viewRules}
			<h3 class="mt-6 mb-3 text-heading-3">Reglas especiales de comisión</h3>
			<div data-testid="special-rules">
				<Table columns={ruleColumns} rows={ruleRows} caption="Reglas especiales de comisión">
					{#snippet cell({ row, column })}
						{#if column.key === 'status'}
							<StatusBadge kind="commissionRule" status={row.status} />
						{:else}
							{row[column.key as keyof RuleRow]}
						{/if}
					{/snippet}
					{#snippet empty()}
						<EmptyState title="Este cobrador no tiene reglas especiales" />
					{/snippet}
				</Table>
			</div>
			{#if data.can.manageRules}
				<div class="mt-3">
					<Button href={resolve('/campaigns/[id]/commissions', { id: data.campaign.id })}
						>Gestionar reglas especiales</Button
					>
				</div>
			{/if}
		{/if}
	</Section>

	<Section id="section-7" number={7} title={sections[6]}>
		<p class="m-0 text-muted">
			Todavía no hay datos. El informe mensual se incorpora más adelante.
		</p>
	</Section>

	<Section id="section-8" number={8} title={sections[7]}>
		{#if !data.can.audit}
			<p class="m-0 text-muted">No hay permiso para ver el registro de auditoría.</p>
		{:else if data.audit?.entries.length === 0}
			<EmptyState title="No hay movimientos de auditoría para este cobrador" />
		{:else}
			<ol class="m-0 flex list-none flex-col divide-y divide-border p-0">
				{#each data.audit?.entries ?? [] as entry (entry.id)}
					<li class="py-3">
						<strong>{entry.action}</strong>
						<span class="text-muted"
							>· {entry.actorName ?? 'Usuario desconocido'} · {formatDateTime(
								entry.createdAt
							)}</span
						>
					</li>
				{/each}
			</ol>
		{/if}
	</Section>
</div>

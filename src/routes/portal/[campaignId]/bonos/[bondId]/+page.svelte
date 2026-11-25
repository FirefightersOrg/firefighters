<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		Card,
		EmptyState,
		PageHeader,
		StatusBadge,
		Table,
		type TableColumn
	} from '$lib/components/ui';
	import { DELIVERY_NOTE_REASON_LABELS, deliveryNoteLabel } from '$lib/domain/deliveries';
	import { formatDateTime, formatMoney } from '$lib/format';
	import type { PageProps } from './$types';

	/** Reduced, read-only view of one own bond: no buyer or payment data. */
	let { data }: PageProps = $props();

	const ASSIGNMENT_TYPE_LABELS = {
		delivery: 'Entrega',
		return: 'Devolución',
		reassignment: 'Reasignación',
		lost: 'Extravío'
	} as const;

	const bond = $derived(data.bond);
	const listHref = $derived(
		resolve('/portal/[campaignId]/bonos', { campaignId: data.campaign.id })
	);
	const join = (values: string[]) => (values.length ? values.join(', ') : '—');
	const printHref = (noteId: string) =>
		resolve('/portal/[campaignId]/remitos/[deliveryNoteId]/imprimir', {
			campaignId: data.campaign.id,
			deliveryNoteId: noteId
		});

	type AssignmentRow = (typeof data.assignments)[number] & Record<string, unknown>;
	type NoteRow = (typeof data.notes)[number] & Record<string, unknown>;
	const assignmentColumns: TableColumn<AssignmentRow>[] = [
		{ key: 'type', header: 'Movimiento' },
		{ key: 'status', header: 'Estado' },
		{ key: 'assignedAt', header: 'Fecha' },
		{ key: 'returnedAt', header: 'Devuelto' },
		{ key: 'note', header: 'Remito' }
	];
	const noteColumns: TableColumn<NoteRow>[] = [
		{ key: 'note', header: 'Remito' },
		{ key: 'reason', header: 'Motivo' },
		{ key: 'status', header: 'Estado' },
		{ key: 'issuedAt', header: 'Emitido' },
		{ key: 'print', header: 'Versión imprimible' }
	];
</script>

<svelte:head>
	<title>Bono {join(bond.baseNumbers)} - Firefighters</title>
</svelte:head>

<PageHeader
	title={`Bono ${join(bond.baseNumbers)}`}
	description={`Campaña ${data.campaign.name}`}
	breadcrumbs={[
		{ label: 'Mi portal', href: resolve('/portal') },
		{ label: 'Mis bonos', href: listHref },
		{ label: `Bono ${join(bond.baseNumbers)}` }
	]}
/>

<div class="flex flex-col gap-6">
	<Card title="Datos del bono">
		<dl class="m-0 grid grid-cols-1 gap-4 sm:grid-cols-3">
			<div>
				<dt class="text-label text-muted">Tipo</dt>
				<dd class="m-0">{bond.typeLabel}</dd>
			</div>
			<div>
				<dt class="text-label text-muted">Número base</dt>
				<dd class="m-0 font-mono">{join(bond.baseNumbers)}</dd>
			</div>
			<div>
				<dt class="text-label text-muted">Número asociado</dt>
				<dd class="m-0 font-mono">{join(bond.associatedNumbers)}</dd>
			</div>
			<div>
				<dt class="text-label text-muted">Estado comercial</dt>
				<dd class="m-0"><StatusBadge kind="bondCommercial" status={bond.commercialStatus} /></dd>
			</div>
			<div>
				<dt class="text-label text-muted">Estado financiero</dt>
				<dd class="m-0"><StatusBadge kind="bondFinancial" status={bond.financialStatus} /></dd>
			</div>
			<div>
				<dt class="text-label text-muted">Valor</dt>
				<dd class="m-0 tabular-nums">{formatMoney(bond.totalValue)}</dd>
			</div>
		</dl>
	</Card>

	<Card title="Historial de asignaciones">
		<Table
			columns={assignmentColumns}
			rows={data.assignments as AssignmentRow[]}
			caption="Historial de asignaciones"
		>
			{#snippet cell({ row, column })}
				{#if column.key === 'type'}
					{ASSIGNMENT_TYPE_LABELS[row.assignmentType]}
				{:else if column.key === 'status'}
					<StatusBadge kind="assignment" status={row.status} />
				{:else if column.key === 'assignedAt'}
					{formatDateTime(row.assignedAt)}
				{:else if column.key === 'returnedAt'}
					{formatDateTime(row.returnedAt)}
				{:else}
					{row.noteNumber === null ? '—' : deliveryNoteLabel(row.noteNumber)}
				{/if}
			{/snippet}
			{#snippet empty()}
				<EmptyState title="Sin movimientos">Este bono todavía no tiene historial.</EmptyState>
			{/snippet}
		</Table>
	</Card>

	<Card title="Remitos recibidos">
		<Table columns={noteColumns} rows={data.notes as NoteRow[]} caption="Remitos recibidos">
			{#snippet cell({ row, column })}
				{#if column.key === 'note'}
					{deliveryNoteLabel(row.noteNumber)}
				{:else if column.key === 'reason'}
					{DELIVERY_NOTE_REASON_LABELS[row.reason]}
				{:else if column.key === 'status'}
					<StatusBadge kind="deliveryNote" status={row.status} />
				{:else if column.key === 'issuedAt'}
					{formatDateTime(row.issuedAt)}
				{:else}
					<a
						href={printHref(row.id)}
						class="rounded-sm text-primary underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
						>Ver remito</a
					>
				{/if}
			{/snippet}
			{#snippet empty()}
				<EmptyState title="Sin remitos">No hay remitos de entrega para este bono.</EmptyState>
			{/snippet}
		</Table>
	</Card>
</div>

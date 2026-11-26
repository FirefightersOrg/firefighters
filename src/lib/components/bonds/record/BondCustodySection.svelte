<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import {
		Alert,
		Button,
		Dialog,
		Field,
		Select,
		StatusBadge,
		Table,
		TextInput,
		type TableColumn
	} from '$lib/components/ui';
	import type { AssignmentType, BondAssignment } from '$lib/domain/deliveries';
	import { formatDate, formatDateTime } from '$lib/format';
	import RecordSection from './RecordSection.svelte';

	/**
	 * Custody (SAN-55): the delivery / reassignment / return / loss history of the bond and, when the
	 * bond's status and the user's permissions allow it, the Return, Reassign and Mark lost actions.
	 */
	let {
		campaignId,
		fromCollectorId,
		history,
		collectors,
		can,
		form
	}: {
		campaignId: string;
		fromCollectorId: string | null;
		history: BondAssignment[];
		collectors: { id: string; displayName: string }[];
		can: { returnBond: boolean; reassign: boolean; markLost: boolean };
		form: {
			form?: string;
			action?: string;
			success?: boolean;
			message?: string;
			errors?: Record<string, string[]>;
			values?: Record<string, string>;
		} | null;
	} = $props();

	const EVENT_LABELS: Record<AssignmentType, string> = {
		delivery: 'Entrega',
		return: 'Devolución',
		reassignment: 'Reasignación',
		lost: 'Extravío'
	};
	const custody = $derived(form?.form === 'custody' ? form : null);
	const errorsOf = (action: string) =>
		custody?.action === action && !custody.success ? (custody.errors ?? {}) : {};
	const valueOf = (action: string, name: string) =>
		custody?.action === action ? (custody.values?.[name] ?? '') : '';
	const today = new Date().toISOString().slice(0, 10);
	const noteHref = (noteId: string) =>
		resolve('/campaigns/[id]/deliveries/[noteId]', { id: campaignId, noteId });

	// A failed submit (no JavaScript, or a server error) reopens the dialog with its errors.
	let lostOpen = $state(Object.keys(errorsOf('markLost')).length > 0);
	let lostSubmitting = $state(false);

	type HistoryRow = BondAssignment & Record<string, unknown>;
	const columns: TableColumn<HistoryRow>[] = [
		{ key: 'event', header: 'Evento' },
		{ key: 'collector', header: 'Cobrador' },
		{ key: 'date', header: 'Fecha' },
		{ key: 'note', header: 'Remito' },
		{ key: 'details', header: 'Detalle' }
	];
	const rows = $derived(history as HistoryRow[]);
	const collectorOptions = $derived([
		{ value: '', label: 'Elegir…' },
		...collectors.map((c) => ({ value: c.id, label: c.displayName }))
	]);
</script>

<RecordSection id="custody">
	<div class="flex flex-col gap-4">
		{#if custody?.message}
			<Alert tone={custody.success ? 'success' : 'danger'}>{custody.message}</Alert>
		{/if}

		{#if history.length === 0}
			<p class="m-0 text-body-sm text-muted">Este bono no se entregó a ningún cobrador.</p>
		{:else}
			<Table {columns} {rows} caption="Historial de asignaciones" density="compact">
				{#snippet cell({ row, column })}
					{#if column.key === 'event'}
						{EVENT_LABELS[row.assignmentType]}
						{#if row.status === 'active'}<span class="ml-1"
								><StatusBadge kind="assignment" status="active" /></span
							>{/if}
					{:else if column.key === 'collector'}
						{row.collectorName ?? (row.collectorId ? '—' : 'Sin entregar')}
					{:else if column.key === 'date'}
						<span class="tabular-nums">{formatDateTime(row.assignedAt)}</span>
					{:else if column.key === 'note'}
						{#if row.deliveryNoteId && row.noteNumber}
							<a
								href={noteHref(row.deliveryNoteId)}
								class="font-mono text-primary-text underline-offset-2 hover:underline"
								>Remito {String(row.noteNumber).padStart(4, '0')}</a
							>
						{:else}—{/if}
					{:else if column.key === 'details'}
						<span class="text-caption text-muted">
							{#if row.assignmentType === 'lost'}
								Responsable: {row.responsibleParty}. Extraviado el {formatDate(
									row.lostOn
								)}.{row.notes ? ` ${row.notes}` : ''}
							{:else if row.notes}{row.notes}{/if}
						</span>
					{/if}
				{/snippet}
			</Table>
		{/if}

		{#if can.returnBond}
			<form method="POST" action="?/return" class="flex flex-wrap items-end gap-3" use:enhance>
				<input type="hidden" name="fromCollectorId" value={fromCollectorId ?? ''} />
				<div class="min-w-64 flex-1">
					<Field
						label="Devolver al stock (notas)"
						id="return-notes"
						optional
						error={errorsOf('return').notes?.[0]}
					>
						<TextInput name="notes" maxlength={2000} value={valueOf('return', 'notes')} />
					</Field>
				</div>
				<Button type="submit">Devolver</Button>
			</form>
		{/if}

		{#if can.reassign}
			<form method="POST" action="?/reassign" class="flex flex-wrap items-end gap-3" use:enhance>
				<input type="hidden" name="fromCollectorId" value={fromCollectorId ?? ''} />
				<div class="min-w-64 flex-1">
					<Field
						label="Reasignar a"
						id="reassign-collector"
						required
						hint={collectors.length === 0
							? 'No hay otro cobrador visible para esta cuenta; consultar a un administrador.'
							: undefined}
						error={errorsOf('reassign').collectorId?.[0]}
					>
						<Select
							name="collectorId"
							options={collectorOptions}
							value={valueOf('reassign', 'collectorId')}
						/>
					</Field>
				</div>
				<Button type="submit">Reasignar</Button>
			</form>
		{/if}

		{#if can.markLost}
			<div>
				<Button variant="danger" aria-haspopup="dialog" onclick={() => (lostOpen = true)}>
					Marcar como extraviado
				</Button>
			</div>
		{/if}
	</div>
</RecordSection>

{#if can.markLost}
	<Dialog
		open={lostOpen}
		onClose={() => (lostOpen = false)}
		title="¿Marcar este bono como extraviado?"
		description="El bono queda registrado como extraviado a cargo de la persona responsable. No se puede deshacer."
		confirmLabel="Marcar como extraviado"
		tone="danger"
		loading={lostSubmitting}
		action="?/markLost"
		enhance={(f) =>
			enhance(f, () => {
				lostSubmitting = true;
				return async ({ update }) => {
					try {
						lostOpen = false;
						await update();
					} finally {
						lostSubmitting = false;
					}
				};
			})}
	>
		<Field
			label="Responsable"
			id="lost-responsible"
			required
			error={errorsOf('markLost').responsibleParty?.[0]}
		>
			<TextInput
				name="responsibleParty"
				maxlength={200}
				value={valueOf('markLost', 'responsibleParty')}
			/>
		</Field>
		<Field label="Extraviado el" id="lost-on" required error={errorsOf('markLost').lostOn?.[0]}>
			<TextInput name="lostOn" type="date" max={today} value={valueOf('markLost', 'lostOn')} />
		</Field>
		<Field label="Motivo" id="lost-reason" required error={errorsOf('markLost').reason?.[0]}>
			<TextInput name="reason" maxlength={2000} value={valueOf('markLost', 'reason')} />
		</Field>
	</Dialog>
{/if}

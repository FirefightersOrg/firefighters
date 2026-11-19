<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import FieldError from '$lib/components/campaigns/FieldError.svelte';
	import FormAlert from '$lib/components/campaigns/FormAlert.svelte';
	import {
		dangerButtonClass,
		inputClass,
		labelClass,
		secondaryButtonClass
	} from '$lib/components/campaigns/styles';
	import {
		ASSIGNMENT_TYPE_LABELS,
		deliveryNoteLabel,
		type BondAssignment
	} from '$lib/domain/deliveries';
	import RecordSection from './RecordSection.svelte';

	/**
	 * Custody (SAN-55): the delivery / reassignment / return / loss history of the bond and, when the
	 * bond's status and the user's permissions allow it, the Return, Reassign and Mark lost actions.
	 */
	let {
		campaignId,
		history,
		collectors,
		can,
		form
	}: {
		campaignId: string;
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

	const dateTime = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' });
	const custody = $derived(form?.form === 'custody' ? form : null);
	const errorsOf = (action: string) =>
		custody?.action === action && !custody.success ? (custody.errors ?? {}) : {};
	const valueOf = (action: string, name: string) =>
		custody?.action === action ? (custody.values?.[name] ?? '') : '';
	const today = new Date().toISOString().slice(0, 10);
	const noteHref = (noteId: string) =>
		resolve('/campaigns/[id]/deliveries/[noteId]', { id: campaignId, noteId });
</script>

<RecordSection id="custody">
	{#if custody?.message}
		<FormAlert kind={custody.success ? 'success' : 'error'} message={custody.message} />
	{/if}

	{#if history.length === 0}
		<p class="text-sm text-slate-500">This bond has not been delivered to a collector.</p>
	{:else}
		<table class="min-w-full text-sm">
			<thead class="text-left text-xs text-slate-500 uppercase">
				<tr>
					<th class="py-2 pr-3 font-medium">Event</th>
					<th class="py-2 pr-3 font-medium">Collector</th>
					<th class="py-2 pr-3 font-medium">Date</th>
					<th class="py-2 pr-3 font-medium">Note</th>
					<th class="py-2 font-medium">Details</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-slate-100">
				{#each history as a (a.id)}
					<tr>
						<td class="py-2 pr-3">
							{ASSIGNMENT_TYPE_LABELS[a.assignmentType]}
							{#if a.status === 'active'}<span
									class="ml-1 rounded bg-green-100 px-1 text-xs text-green-800">current</span
								>{/if}
						</td>
						<td class="py-2 pr-3">{a.collectorName ?? (a.collectorId ? '—' : 'Not delivered')}</td>
						<td class="py-2 pr-3 tabular-nums">{dateTime.format(new Date(a.assignedAt))}</td>
						<td class="py-2 pr-3">
							{#if a.deliveryNoteId && a.noteNumber}
								<a href={noteHref(a.deliveryNoteId)} class="text-blue-700 hover:underline"
									>{deliveryNoteLabel(a.noteNumber)}</a
								>
							{:else}—{/if}
						</td>
						<td class="py-2 text-xs text-slate-600">
							{#if a.assignmentType === 'lost'}
								Responsible: {a.responsibleParty} · lost on {a.lostOn} · {a.notes}
							{:else if a.notes}{a.notes}{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}

	{#if can.returnBond}
		<form method="POST" action="?/return" class="mt-4 flex flex-wrap items-end gap-3" use:enhance>
			<div class="min-w-64 flex-1">
				<label for="return-notes" class={labelClass}>Return to stock (notes, optional)</label>
				<input
					id="return-notes"
					name="notes"
					maxlength="2000"
					class={inputClass}
					value={valueOf('return', 'notes')}
				/>
				<FieldError id="return-notes-error" errors={errorsOf('return').notes} />
			</div>
			<button type="submit" class={secondaryButtonClass}>Return</button>
		</form>
	{/if}

	{#if can.reassign}
		<form method="POST" action="?/reassign" class="mt-4 flex flex-wrap items-end gap-3" use:enhance>
			<div class="min-w-64 flex-1">
				<label for="reassign-collector" class={labelClass}>Reassign to</label>
				<select
					id="reassign-collector"
					name="collectorId"
					required
					class={inputClass}
					aria-invalid={errorsOf('reassign').collectorId ? 'true' : undefined}
					value={valueOf('reassign', 'collectorId')}
				>
					<option value="">Choose…</option>
					{#each collectors as c (c.id)}<option value={c.id}>{c.displayName}</option>{/each}
				</select>
				{#if collectors.length === 0}<p class="text-xs text-slate-500">
						No other collector you can see; ask an admin.
					</p>{/if}
				<FieldError id="reassign-collector-error" errors={errorsOf('reassign').collectorId} />
			</div>
			<button type="submit" class={secondaryButtonClass}>Reassign</button>
		</form>
	{/if}

	{#if can.markLost}
		<form
			method="POST"
			action="?/markLost"
			class="mt-4 grid gap-3 sm:grid-cols-4 sm:items-end"
			use:enhance
		>
			<div>
				<label for="lost-responsible" class={labelClass}>Responsible party</label>
				<input
					id="lost-responsible"
					name="responsibleParty"
					maxlength="200"
					required
					class={inputClass}
					value={valueOf('markLost', 'responsibleParty')}
					aria-invalid={errorsOf('markLost').responsibleParty ? 'true' : undefined}
				/>
				<FieldError id="lost-responsible-error" errors={errorsOf('markLost').responsibleParty} />
			</div>
			<div>
				<label for="lost-on" class={labelClass}>Lost on</label>
				<input
					id="lost-on"
					name="lostOn"
					type="date"
					max={today}
					required
					class={inputClass}
					value={valueOf('markLost', 'lostOn')}
					aria-invalid={errorsOf('markLost').lostOn ? 'true' : undefined}
				/>
				<FieldError id="lost-on-error" errors={errorsOf('markLost').lostOn} />
			</div>
			<div>
				<label for="lost-reason" class={labelClass}>Reason</label>
				<input
					id="lost-reason"
					name="reason"
					maxlength="2000"
					required
					class={inputClass}
					value={valueOf('markLost', 'reason')}
					aria-invalid={errorsOf('markLost').reason ? 'true' : undefined}
				/>
				<FieldError id="lost-reason-error" errors={errorsOf('markLost').reason} />
			</div>
			<button type="submit" class={dangerButtonClass}>Mark lost</button>
		</form>
	{/if}
</RecordSection>

<script lang="ts">
	import { enhance } from '$app/forms';
	import type { Campaign } from '$lib/domain/campaigns';
	import type { CampaignFieldErrors } from '$lib/schemas/campaign';
	import { Button, Card, Dialog, FormResult } from '$lib/components/ui';
	import { GENERAL_FIELDS } from './fields';
	import GeneralFields from './GeneralFields.svelte';
	import { campaignEditSnapshot, generalValuesOf } from './types';

	/** Edit form for name and dates; posts to the page's `?/update` action. */
	let {
		campaign,
		result,
		nameReadonly = false,
		datesReadonly = false,
		confirmChanges = false
	}: {
		campaign: Campaign;
		/** This form's last action result, if any. */
		result?: {
			success: boolean;
			message: string;
			errors: CampaignFieldErrors;
			values?: Record<string, string>;
		} | null;
		nameReadonly?: boolean;
		datesReadonly?: boolean;
		confirmChanges?: boolean;
	} = $props();

	// Values and version (`updated_at`) are taken once, from the same load: the parent re-mounts
	// this form whenever the campaign's version changes (`campaignEditFormKey`), so they never
	// drift apart. Afterwards the inputs own the values; a failed submit keeps them and the
	// version, so a stale form keeps failing with a conflict instead of overwriting newer changes.
	function initialSnapshot() {
		return campaignEditSnapshot(generalValuesOf(campaign), campaign, result?.values);
	}
	const snapshot = initialSnapshot();
	let values = $state(snapshot.values);
	const expectedVersion = snapshot.version;
	let submitting = $state(false);
	let confirmOpen = $state(false);
	let confirmationAccepted = false;
	let formElement: HTMLFormElement | undefined;
	function confirmBeforeSubmit(node: HTMLFormElement) {
		formElement = node;
		const onSubmit = (event: SubmitEvent) => {
			if (confirmChanges && !confirmationAccepted) {
				event.preventDefault();
				event.stopImmediatePropagation();
				confirmOpen = true;
			} else confirmationAccepted = false;
		};
		node.addEventListener('submit', onSubmit, true);
		return {
			destroy() {
				node.removeEventListener('submit', onSubmit, true);
			}
		};
	}
</script>

<Card title="Datos generales" id="general">
	<form
		use:confirmBeforeSubmit
		method="POST"
		action="?/update"
		class="flex flex-col gap-5"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				try {
					await update({ reset: false });
				} finally {
					submitting = false;
				}
			};
		}}
	>
		<FormResult {result} fields={GENERAL_FIELDS} />
		<!-- Version the edit is based on (optimistic concurrency): see expectedVersion above. -->
		<input type="hidden" name="expectedUpdatedAt" value={expectedVersion} />
		<GeneralFields
			bind:name={values.name}
			bind:startsOn={values.startsOn}
			bind:endsOn={values.endsOn}
			errors={result?.errors ?? {}}
			{nameReadonly}
			{datesReadonly}
		/>
		<div>
			<Button type="submit" loading={submitting}>Guardar datos generales</Button>
		</div>
	</form>
</Card>
{#if confirmChanges}
	<Dialog
		open={confirmOpen}
		onClose={() => (confirmOpen = false)}
		title="¿Guardar los datos de la campaña?"
		description="Se actualizarán el nombre y las fechas con los valores del formulario. El cambio queda registrado en la auditoría."
		confirmLabel="Guardar datos generales"
		onConfirm={() => {
			confirmationAccepted = true;
			confirmOpen = false;
			formElement?.requestSubmit();
		}}
	>
		<p>{values.name}</p>
	</Dialog>
{/if}

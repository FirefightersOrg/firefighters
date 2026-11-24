<script lang="ts">
	import { enhance } from '$app/forms';
	import type { Campaign } from '$lib/domain/campaigns';
	import type { CampaignFieldErrors } from '$lib/schemas/campaign';
	import { Button, Card, FormResult } from '$lib/components/ui';
	import { GENERAL_FIELDS } from './fields';
	import GeneralFields from './GeneralFields.svelte';
	import { campaignEditSnapshot, generalValuesOf } from './types';

	/** Edit form for name and dates; posts to the page's `?/update` action. */
	let {
		campaign,
		result,
		nameReadonly = false,
		datesReadonly = false
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
</script>

<Card title="Datos generales" id="general">
	<form
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

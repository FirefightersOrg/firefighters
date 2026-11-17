<script lang="ts">
	import { enhance } from '$app/forms';
	import type { Campaign } from '$lib/domain/campaigns';
	import type { CampaignFieldErrors } from '$lib/schemas/campaign';
	import FormAlert from './FormAlert.svelte';
	import GeneralFields from './GeneralFields.svelte';
	import { cardClass, primaryButtonClass } from './styles';
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

<section class={cardClass} aria-labelledby="general-title">
	<h2 id="general-title" class="mb-4 text-base font-semibold">General data</h2>
	<form
		method="POST"
		action="?/update"
		class="space-y-4"
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
		{#if result}
			<FormAlert kind={result.success ? 'success' : 'error'} message={result.message} />
		{/if}
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
		<div class="flex justify-end">
			<button type="submit" disabled={submitting} class={primaryButtonClass}>
				{submitting ? 'Saving…' : 'Save general data'}
			</button>
		</div>
	</form>
</section>

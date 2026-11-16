<script lang="ts">
	import { enhance } from '$app/forms';
	import type { Campaign } from '$lib/domain/campaigns';
	import type { CampaignFieldErrors } from '$lib/schemas/campaign';
	import FormAlert from './FormAlert.svelte';
	import GeneralFields from './GeneralFields.svelte';
	import { cardClass, primaryButtonClass } from './styles';
	import { generalValuesOf, withSubmitted } from './types';

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

	// Initial values only (the parent re-mounts this form per campaign): afterwards the inputs own
	// them. Without JavaScript, a failed submit refills them from `result.values`.
	function initialValues() {
		return withSubmitted(generalValuesOf(campaign), result?.values);
	}
	let values = $state(initialValues());
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

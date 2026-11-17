<script lang="ts">
	import { enhance } from '$app/forms';
	import type { Campaign } from '$lib/domain/campaigns';
	import { previewInstallmentValue } from '$lib/domain/installments';
	import type { CampaignFieldErrors } from '$lib/schemas/campaign';
	import FormAlert from './FormAlert.svelte';
	import RulesFields from './RulesFields.svelte';
	import { cardClass, primaryButtonClass } from './styles';
	import { rulesValuesOf, withSubmitted } from './types';

	/** Edit form for the rules of a draft campaign; posts to the page's `?/rules` action. */
	let {
		campaign,
		result
	}: {
		campaign: Campaign;
		/** This form's last action result, if any. */
		result?: {
			success: boolean;
			message: string;
			errors: CampaignFieldErrors;
			values?: Record<string, string>;
		} | null;
	} = $props();

	function initialValues() {
		return withSubmitted(rulesValuesOf(campaign), result?.values);
	}
	let values = $state(initialValues());
	let submitting = $state(false);

	// The campaign version (`updated_at`, exact string) this edit is based on. It follows the
	// loaded campaign, so a successful save of any form on the page (which reloads it) moves it
	// forward. After a failed submit it stays at the submitted version: a stale form keeps
	// failing with a conflict until the page is reloaded, instead of overwriting newer changes.
	const expectedVersion = $derived(result?.values?.expectedUpdatedAt ?? campaign.updatedAt);

	const installmentError = $derived(
		previewInstallmentValue(values.simpleBondValue, values.installmentCount).state === 'error'
	);
</script>

<section class="{cardClass} space-y-4" aria-labelledby="rules-title">
	<h2 id="rules-title" class="text-base font-semibold">Rules</h2>
	<FormAlert kind="warning">
		<p>
			Rules can only be changed while the campaign is a draft. <strong
				>Activating the campaign freezes them.</strong
			>
		</p>
	</FormAlert>
	<form
		method="POST"
		action="?/rules"
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
		<RulesFields bind:values errors={result?.errors ?? {}} />
		<div class="flex justify-end">
			<button type="submit" disabled={submitting || installmentError} class={primaryButtonClass}>
				{submitting ? 'Saving…' : 'Save rules'}
			</button>
		</div>
	</form>
</section>

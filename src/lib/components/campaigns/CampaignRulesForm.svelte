<script lang="ts">
	import { enhance } from '$app/forms';
	import type { Campaign } from '$lib/domain/campaigns';
	import { previewInstallmentValue } from '$lib/domain/installments';
	import {
		CAMPAIGN_RULES_CONFIRM_FIELD,
		CAMPAIGN_RULES_CONFIRM_VALUE,
		CAMPAIGN_RULES_REASON_FIELD,
		CAMPAIGN_RULES_REASON_MAX_LENGTH,
		type CampaignFieldErrors
	} from '$lib/schemas/campaign';
	import FieldError from './FieldError.svelte';
	import FormAlert from './FormAlert.svelte';
	import RulesFields from './RulesFields.svelte';
	import { diffCampaignRules } from './rules-diff';
	import { cardClass, hintClass, inputClass, labelClass, primaryButtonClass } from './styles';
	import { rulesValuesOf, withSubmitted } from './types';

	/**
	 * Edit form for the rules of a draft campaign; posts to the page's `?/rules` action. Only
	 * rendered while the campaign is a draft (the page shows frozen rules read-only otherwise).
	 *
	 * Rule-change protection: a warning that changes are audited and frozen on activation, a
	 * summary of the changed fields (old → new) and a required confirmation checkbox. The checkbox
	 * is a plain `required` input, so it works without JavaScript, and the server rejects a
	 * submit without it. Without JavaScript the summary appears after the first submit (it is
	 * rendered from the submitted values the server sends back). An optional reason is stored in
	 * the audit row with the change.
	 */
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
	const changes = $derived(diffCampaignRules(campaign, values));
	// The confirmation applies to one exact set of changes: editing the rules again un-ticks it.
	const changesKey = $derived(JSON.stringify(changes));
	let confirmedFor = $state<string | null>(null);
	const confirmErrors = $derived(result?.errors[CAMPAIGN_RULES_CONFIRM_FIELD]);
	const reasonErrors = $derived(result?.errors[CAMPAIGN_RULES_REASON_FIELD]);
	// Refilled from the submitted values when JavaScript is off; cleared after a successful save.
	function initialReason() {
		return result?.values?.[CAMPAIGN_RULES_REASON_FIELD] ?? '';
	}
	let changeReason = $state(initialReason());
</script>

<section class="{cardClass} space-y-4" aria-labelledby="rules-title">
	<h2 id="rules-title" class="text-base font-semibold">Rules</h2>
	<FormAlert kind="warning">
		<p>
			Rules can only be changed while the campaign is a draft. Every saved change is recorded in the
			audit log with its previous and new values. <strong
				>Activating the campaign freezes the rules.</strong
			>
		</p>
	</FormAlert>
	<form
		method="POST"
		action="?/rules"
		class="space-y-4"
		use:enhance={() => {
			submitting = true;
			return async ({ update, result: actionResult }) => {
				try {
					await update({ reset: false });
					if (actionResult.type === 'success') changeReason = '';
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

		<div
			id="rules-changes"
			aria-live="polite"
			class="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm"
		>
			<h3 class="text-xs font-semibold uppercase tracking-wider text-slate-500">Changes to save</h3>
			{#if changes.length === 0}
				<p class="mt-2 text-slate-500">No rule has been changed yet.</p>
			{:else}
				<ul class="mt-2 space-y-1">
					{#each changes as change (change.field)}
						<li>
							<span class="font-medium">{change.label}:</span>
							<span class="tabular-nums text-slate-500 line-through decoration-slate-400"
								>{change.from}</span
							>
							<span aria-hidden="true">→</span><span class="sr-only">changes to</span>
							<span class="tabular-nums font-medium text-slate-900">{change.to}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<div>
			<label for={CAMPAIGN_RULES_REASON_FIELD} class={labelClass}>Reason (optional)</label>
			<textarea
				id={CAMPAIGN_RULES_REASON_FIELD}
				name={CAMPAIGN_RULES_REASON_FIELD}
				rows="2"
				maxlength={CAMPAIGN_RULES_REASON_MAX_LENGTH}
				bind:value={changeReason}
				aria-invalid={reasonErrors?.length ? 'true' : undefined}
				aria-describedby={reasonErrors?.length
					? `${CAMPAIGN_RULES_REASON_FIELD}-hint ${CAMPAIGN_RULES_REASON_FIELD}-error`
					: `${CAMPAIGN_RULES_REASON_FIELD}-hint`}
				class={inputClass}></textarea>
			<p id="{CAMPAIGN_RULES_REASON_FIELD}-hint" class={hintClass}>
				Why the rules change, e.g. a board decision. Saved in the audit log with the change (up to
				{CAMPAIGN_RULES_REASON_MAX_LENGTH} characters).
			</p>
			<FieldError id="{CAMPAIGN_RULES_REASON_FIELD}-error" errors={reasonErrors} />
		</div>

		<div>
			<div class="flex items-start gap-2">
				<input
					id={CAMPAIGN_RULES_CONFIRM_FIELD}
					name={CAMPAIGN_RULES_CONFIRM_FIELD}
					type="checkbox"
					value={CAMPAIGN_RULES_CONFIRM_VALUE}
					required
					checked={confirmedFor === changesKey}
					onchange={(event) => {
						confirmedFor = event.currentTarget.checked ? changesKey : null;
					}}
					aria-invalid={confirmErrors?.length ? 'true' : undefined}
					aria-describedby={confirmErrors?.length
						? `rules-changes ${CAMPAIGN_RULES_CONFIRM_FIELD}-error`
						: 'rules-changes'}
					class="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
				/>
				<label for={CAMPAIGN_RULES_CONFIRM_FIELD} class="text-sm text-slate-700">
					I reviewed these rule changes. I understand they are recorded in the audit log and that
					the rules freeze when the campaign is activated.
				</label>
			</div>
			<FieldError id="{CAMPAIGN_RULES_CONFIRM_FIELD}-error" errors={confirmErrors} />
		</div>

		<div class="flex justify-end">
			<button type="submit" disabled={submitting || installmentError} class={primaryButtonClass}>
				{submitting ? 'Saving…' : 'Save rules'}
			</button>
		</div>
	</form>
</section>

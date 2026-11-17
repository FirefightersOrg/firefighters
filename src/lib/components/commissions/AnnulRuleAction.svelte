<script lang="ts">
	import { enhance } from '$app/forms';
	import {
		dangerButtonClass,
		inputClass,
		labelClass,
		secondaryButtonClass
	} from '$lib/components/campaigns/styles';
	import { COMMISSION_REASON_MAX_LENGTH } from '$lib/schemas/commission-rule';

	/**
	 * "Annul" button with a confirmation dialog asking for the (required) reason. The dialog is an
	 * HTML popover (`popovertarget`), so it opens without JavaScript; with JavaScript the form is
	 * enhanced. Posts `ruleId` and `reason` to the page's `?/annul` action.
	 */
	let { ruleId, description }: { ruleId: string; description: string } = $props();

	const popoverId = $derived(`annul-${ruleId}`);
	let popover = $state<HTMLElement>();
	let submitting = $state(false);
</script>

<button
	type="button"
	popovertarget={popoverId}
	class="text-sm font-medium text-red-700 hover:underline"
	aria-label="Annul rule: {description}"
>
	Annul
</button>

<div
	id={popoverId}
	popover="auto"
	bind:this={popover}
	role="dialog"
	aria-labelledby="{popoverId}-title"
	class="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-6 text-left text-slate-900 shadow-xl backdrop:bg-slate-900/40"
>
	<h3 id="{popoverId}-title" class="text-lg font-semibold">Annul this rule?</h3>
	<p class="mt-2 text-sm text-slate-600">
		<span class="font-medium">{description}</span>. The rule is kept for the record but no longer
		applies, and it stops blocking its dates for new rules. This cannot be undone.
	</p>

	<form
		method="POST"
		action="?/annul"
		class="mt-4 space-y-4"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				try {
					popover?.hidePopover();
					await update();
				} finally {
					submitting = false;
				}
			};
		}}
	>
		<input type="hidden" name="ruleId" value={ruleId} />
		<div>
			<label for="{popoverId}-reason" class={labelClass}>Reason (required)</label>
			<textarea
				id="{popoverId}-reason"
				name="reason"
				required
				rows="3"
				maxlength={COMMISSION_REASON_MAX_LENGTH}
				class={inputClass}></textarea>
		</div>
		<div class="flex flex-wrap justify-end gap-2">
			<button
				type="button"
				popovertarget={popoverId}
				popovertargetaction="hide"
				class={secondaryButtonClass}
			>
				Cancel
			</button>
			<button type="submit" disabled={submitting} class={dangerButtonClass}>Annul rule</button>
		</div>
	</form>
</div>

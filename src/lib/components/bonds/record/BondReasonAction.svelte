<script lang="ts">
	import { enhance } from '$app/forms';
	import FieldError from '$lib/components/campaigns/FieldError.svelte';
	import {
		dangerButtonClass,
		inputClass,
		labelClass,
		secondaryButtonClass
	} from '$lib/components/campaigns/styles';
	import { BOND_REASON_MAX_LENGTH } from '$lib/schemas/bond';

	/**
	 * A bond action that needs a reason (ungroup, annul): a button that opens a confirmation dialog
	 * (HTML popover, works without JavaScript) posting `reason` to `?/<action>`.
	 */
	let {
		action,
		label,
		title,
		body,
		confirm,
		errors
	}: {
		action: 'ungroup' | 'annul';
		label: string;
		title: string;
		body: string;
		confirm: string;
		/** Reason errors of the last submit. */
		errors?: string[];
	} = $props();

	const popoverId = $derived(`confirm-${action}`);
	let popover = $state<HTMLElement>();
	let submitting = $state(false);
</script>

<div>
	<button type="button" popovertarget={popoverId} class={dangerButtonClass}>{label}</button>
	<FieldError id="{popoverId}-error" {errors} />
</div>

<div
	id={popoverId}
	popover="auto"
	bind:this={popover}
	role="dialog"
	aria-labelledby="{popoverId}-title"
	class="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-6 text-slate-900 shadow-xl backdrop:bg-slate-900/40"
>
	<h3 id="{popoverId}-title" class="text-lg font-semibold">{title}</h3>
	<p class="mt-2 text-sm text-slate-600">{body}</p>
	<form
		method="POST"
		action="?/{action}"
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
		<div>
			<label for="{popoverId}-reason" class={labelClass}>Reason (required)</label>
			<textarea
				id="{popoverId}-reason"
				name="reason"
				required
				rows="3"
				maxlength={BOND_REASON_MAX_LENGTH}
				class={inputClass}></textarea>
		</div>
		<div class="flex flex-wrap justify-end gap-2">
			<button
				type="button"
				popovertarget={popoverId}
				popovertargetaction="hide"
				class={secondaryButtonClass}>Cancel</button
			>
			<button type="submit" disabled={submitting} class={dangerButtonClass}>{confirm}</button>
		</div>
	</form>
</div>

<script lang="ts">
	import { enhance } from '$app/forms';
	import { CAMPAIGN_REASON_MAX_LENGTH } from '$lib/schemas/campaign';
	import type { CampaignTransitionTarget } from '$lib/domain/campaigns';
	import {
		dangerButtonClass,
		inputClass,
		labelClass,
		primaryButtonClass,
		secondaryButtonClass
	} from './styles';

	/**
	 * A status-change button with a confirmation dialog. The dialog is an HTML popover
	 * (`popovertarget`), so it opens without JavaScript; with JavaScript the form is enhanced.
	 * Posts `toStatus` and `reason` to the page's `?/transition` action. Every transition takes a
	 * reason (stored in the audit log); only annulment requires one.
	 */
	let {
		toStatus,
		blockedReason
	}: {
		toStatus: CampaignTransitionTarget;
		/** When set, the action is shown disabled with this explanation. */
		blockedReason?: string;
	} = $props();

	const CONFIG: Record<
		CampaignTransitionTarget,
		{ label: string; title: string; body: string; confirm: string; tone: string }
	> = {
		active: {
			label: 'Activate',
			title: 'Activate this campaign?',
			body:
				'Activation freezes the rules: numbering, installments, bond value, overflow policy and ' +
				'barcode mode can no longer be changed. Name and dates stay editable.',
			confirm: 'Activate campaign',
			tone: primaryButtonClass
		},
		closing: {
			label: 'Start closing',
			title: 'Move this campaign to closing?',
			body: 'Dates become read-only and the campaign can only be closed afterwards. This cannot be undone.',
			confirm: 'Start closing',
			tone: secondaryButtonClass
		},
		closed: {
			label: 'Close campaign',
			title: 'Close this campaign?',
			body: 'A closed campaign is read-only and allows no further operations. This cannot be undone.',
			confirm: 'Close campaign',
			tone: secondaryButtonClass
		},
		annulled: {
			label: 'Annul',
			title: 'Annul this campaign?',
			body: 'The campaign is kept for the record but can no longer be used. This cannot be undone.',
			confirm: 'Annul campaign',
			tone: dangerButtonClass
		}
	};

	const config = $derived(CONFIG[toStatus]);
	const popoverId = $derived(`confirm-${toStatus}`);
	const reasonRequired = $derived(toStatus === 'annulled');
	let popover = $state<HTMLElement>();
	let submitting = $state(false);
</script>

<div>
	<button
		type="button"
		popovertarget={popoverId}
		disabled={!!blockedReason}
		aria-describedby={blockedReason ? `${popoverId}-blocked` : undefined}
		class={config.tone}
	>
		{config.label}
	</button>
	{#if blockedReason}
		<p id="{popoverId}-blocked" class="mt-1 text-xs text-slate-500">{blockedReason}</p>
	{/if}
</div>

<div
	id={popoverId}
	popover="auto"
	bind:this={popover}
	role="dialog"
	aria-labelledby="{popoverId}-title"
	class="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-6 text-slate-900 shadow-xl backdrop:bg-slate-900/40"
>
	<h3 id="{popoverId}-title" class="text-lg font-semibold">{config.title}</h3>
	<p class="mt-2 text-sm text-slate-600">{config.body}</p>

	<form
		method="POST"
		action="?/transition"
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
		<input type="hidden" name="toStatus" value={toStatus} />
		<div>
			<label for="{popoverId}-reason" class={labelClass}>
				Reason ({reasonRequired ? 'required' : 'optional'})
			</label>
			<textarea
				id="{popoverId}-reason"
				name="reason"
				required={reasonRequired}
				rows="3"
				maxlength={CAMPAIGN_REASON_MAX_LENGTH}
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
			<button type="submit" disabled={submitting} class={config.tone}>{config.confirm}</button>
		</div>
	</form>
</div>

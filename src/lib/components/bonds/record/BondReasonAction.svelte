<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button, Dialog, Field, Textarea } from '$lib/components/ui';
	import { BOND_REASON_MAX_LENGTH } from '$lib/schemas/bond';

	/**
	 * A bond action that needs a reason (ungroup, annul): a button that opens a confirmation
	 * `Dialog` posting `reason` to `?/<action>` (enhanced when JavaScript is on).
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
	let open = $state(false);
	let submitting = $state(false);
</script>

<div>
	<Button variant="danger" aria-haspopup="dialog" onclick={() => (open = true)}>{label}</Button>
	{#if errors?.length}
		<p id="{popoverId}-error" class="m-0 mt-1 text-body-sm text-danger-text">{errors[0]}</p>
	{/if}
</div>

<Dialog
	{open}
	onClose={() => (open = false)}
	{title}
	description={body}
	confirmLabel={confirm}
	tone="danger"
	loading={submitting}
	action="?/{action}"
	enhance={(form) =>
		enhance(form, () => {
			submitting = true;
			return async ({ update }) => {
				try {
					open = false;
					await update();
				} finally {
					submitting = false;
				}
			};
		})}
>
	<Field label="Motivo" id="{popoverId}-reason" required>
		<Textarea name="reason" rows={3} required maxlength={BOND_REASON_MAX_LENGTH} />
	</Field>
</Dialog>

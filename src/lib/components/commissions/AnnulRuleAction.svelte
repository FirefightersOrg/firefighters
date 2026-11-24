<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button, Dialog, Field, Textarea } from '$lib/components/ui';
	import { COMMISSION_REASON_MAX_LENGTH } from '$lib/schemas/commission-rule';

	/**
	 * «Anular» button with a confirmation `Dialog` asking for the (required) reason. Posts
	 * `ruleId` and `reason` to the page's `?/annul` action (enhanced when JavaScript is on).
	 */
	let { ruleId, description }: { ruleId: string; description: string } = $props();

	const dialogId = $derived(`annul-${ruleId}`);
	let open = $state(false);
	let submitting = $state(false);
</script>

<Button
	variant="ghost"
	size="sm"
	aria-label="Anular regla: {description}"
	onclick={() => (open = true)}
>
	Anular
</Button>

<Dialog
	{open}
	onClose={() => (open = false)}
	title="¿Anular esta regla?"
	description="{description}. La regla se conserva como registro, pero deja de aplicarse y ya no bloquea sus fechas para reglas nuevas. No se puede deshacer."
	confirmLabel="Anular regla"
	tone="danger"
	loading={submitting}
	action="?/annul"
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
	<input type="hidden" name="ruleId" value={ruleId} />
	<Field label="Motivo" id="{dialogId}-reason" required>
		<Textarea name="reason" rows={3} maxlength={COMMISSION_REASON_MAX_LENGTH} />
	</Field>
</Dialog>

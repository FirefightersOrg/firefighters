<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button, Dialog, Field, Textarea } from '$lib/components/ui';
	import { CAMPAIGN_REASON_MAX_LENGTH } from '$lib/schemas/campaign';
	import type { CampaignTransitionTarget } from '$lib/domain/campaigns';

	/**
	 * A status-change button with a confirmation `Dialog`. Posts `toStatus` and `reason` to the
	 * page's `?/transition` action (enhanced when JavaScript is on). Every transition takes a
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
		{
			label: string;
			title: string;
			body: string;
			confirm: string;
			tone: 'default' | 'danger';
			primary: boolean;
		}
	> = {
		active: {
			label: 'Activar',
			title: '¿Activar esta campaña?',
			body:
				'La activación congela las reglas: la numeración, las cuotas, el valor del bono, la ' +
				'política de desborde y el modo de código de barras ya no se pueden cambiar. El nombre y ' +
				'las fechas siguen siendo editables.',
			confirm: 'Activar campaña',
			tone: 'default',
			primary: true
		},
		closing: {
			label: 'Iniciar cierre',
			title: '¿Pasar esta campaña a cierre?',
			body: 'Las fechas pasan a solo lectura y después la campaña solo se puede cerrar. No se puede deshacer.',
			confirm: 'Iniciar cierre',
			tone: 'default',
			primary: false
		},
		closed: {
			label: 'Cerrar campaña',
			title: '¿Cerrar esta campaña?',
			body: 'Una campaña cerrada es de solo lectura y no admite más operaciones. No se puede deshacer.',
			confirm: 'Cerrar campaña',
			tone: 'default',
			primary: false
		},
		annulled: {
			label: 'Anular',
			title: '¿Anular esta campaña?',
			body: 'La campaña se conserva como registro, pero ya no se puede usar. No se puede deshacer.',
			confirm: 'Anular campaña',
			tone: 'danger',
			primary: false
		}
	};

	const config = $derived(CONFIG[toStatus]);
	const popoverId = $derived(`confirm-${toStatus}`);
	const reasonRequired = $derived(toStatus === 'annulled');
	let open = $state(false);
	let submitting = $state(false);
</script>

<div>
	<Button
		variant={config.primary ? 'primary' : 'secondary'}
		disabled={!!blockedReason}
		aria-describedby={blockedReason ? `${popoverId}-blocked` : undefined}
		onclick={() => (open = true)}
	>
		{config.label}
	</Button>
	{#if blockedReason}
		<p id="{popoverId}-blocked" class="m-0 mt-1 max-w-prose text-body-sm text-muted">
			{blockedReason}
		</p>
	{/if}
</div>

<Dialog
	{open}
	onClose={() => (open = false)}
	title={config.title}
	description={config.body}
	confirmLabel={config.confirm}
	tone={config.tone}
	loading={submitting}
	action="?/transition"
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
	<input type="hidden" name="toStatus" value={toStatus} />
	<Field
		label="Motivo"
		id="{popoverId}-reason"
		optional={!reasonRequired}
		required={reasonRequired}
	>
		<Textarea name="reason" rows={3} maxlength={CAMPAIGN_REASON_MAX_LENGTH} />
	</Field>
</Dialog>

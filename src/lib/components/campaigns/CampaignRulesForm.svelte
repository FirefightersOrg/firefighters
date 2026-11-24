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
	import {
		Alert,
		Button,
		Card,
		Checkbox,
		Field,
		FormResult,
		Icon,
		Textarea
	} from '$lib/components/ui';
	import { RULES_FIELDS } from './fields';
	import RulesFields from './RulesFields.svelte';
	import { diffCampaignRules } from './rules-diff';
	import { campaignEditSnapshot, rulesValuesOf } from './types';

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

	// Values and version (`updated_at`) are taken once, from the same load: the parent re-mounts
	// this form whenever the campaign's version changes (`campaignEditFormKey`), so they never
	// drift apart. Afterwards the inputs own the values; a failed submit keeps them and the
	// version, so a stale form keeps failing with a conflict instead of overwriting newer changes.
	function initialSnapshot() {
		return campaignEditSnapshot(rulesValuesOf(campaign), campaign, result?.values);
	}
	const snapshot = initialSnapshot();
	let values = $state(snapshot.values);
	const expectedVersion = snapshot.version;
	let submitting = $state(false);

	const installmentError = $derived(
		previewInstallmentValue(values.simpleBondValue, values.installmentCount).state === 'error'
	);
	const changes = $derived(diffCampaignRules(campaign, values));
	// The confirmation applies to one exact set of changes: editing the rules again un-ticks it.
	const changesKey = $derived(JSON.stringify(changes));
	let confirmedFor = $state<string | null>(null);
	const confirmErrors = $derived(result?.errors[CAMPAIGN_RULES_CONFIRM_FIELD]);
	const reasonErrors = $derived(result?.errors[CAMPAIGN_RULES_REASON_FIELD]);
	const SUMMARY_FIELDS = [
		...RULES_FIELDS,
		{ name: CAMPAIGN_RULES_REASON_FIELD, label: 'Motivo' },
		{ name: CAMPAIGN_RULES_CONFIRM_FIELD, label: 'Confirmación de la revisión' }
	];
	// Refilled from the submitted values when JavaScript is off (only when they were based on the
	// loaded version, like the rule values above); cleared after a successful save.
	function initialReason() {
		const reason = { [CAMPAIGN_RULES_REASON_FIELD]: '' };
		return campaignEditSnapshot(reason, campaign, result?.values).values[
			CAMPAIGN_RULES_REASON_FIELD
		];
	}
	let changeReason = $state(initialReason());
</script>

<Card title="Reglas" id="rules">
	<div class="flex flex-col gap-5">
		<Alert tone="warning">
			Las reglas solo se pueden cambiar mientras la campaña es un borrador. Cada cambio guardado
			queda en el registro de auditoría con sus valores anterior y nuevo.
			<strong>Activar la campaña congela las reglas.</strong>
		</Alert>
		<form
			method="POST"
			action="?/rules"
			class="flex flex-col gap-5"
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
			<FormResult {result} fields={SUMMARY_FIELDS} />
			<!-- Version the edit is based on (optimistic concurrency): see expectedVersion above. -->
			<input type="hidden" name="expectedUpdatedAt" value={expectedVersion} />
			<RulesFields bind:values errors={result?.errors ?? {}} />

			<div
				id="rules-changes"
				aria-live="polite"
				class="rounded-md border border-border bg-surface-sunken p-4 text-body-sm"
			>
				<h3 class="m-0 text-label text-muted">Cambios a guardar</h3>
				{#if changes.length === 0}
					<p class="m-0 mt-2 text-muted">Todavía no se cambió ninguna regla.</p>
				{:else}
					<ul class="m-0 mt-2 list-none space-y-1 p-0">
						{#each changes as change (change.field)}
							<li>
								<span class="text-label">{change.label}:</span>
								<span class="tabular-nums text-muted line-through">{change.from}</span>
								<span aria-hidden="true">→</span><span class="sr-only">cambia a</span>
								<span class="text-label tabular-nums text-text">{change.to}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			<Field
				label="Motivo"
				id={CAMPAIGN_RULES_REASON_FIELD}
				hint="Por qué cambian las reglas, por ejemplo una decisión de la comisión directiva. Se guarda en el registro de auditoría con el cambio (hasta {CAMPAIGN_RULES_REASON_MAX_LENGTH} caracteres)."
				error={reasonErrors?.[0]}
				optional
			>
				<Textarea
					name={CAMPAIGN_RULES_REASON_FIELD}
					rows={2}
					maxlength={CAMPAIGN_RULES_REASON_MAX_LENGTH}
					bind:value={changeReason}
				/>
			</Field>

			<div class="flex flex-col gap-1">
				<Checkbox
					id={CAMPAIGN_RULES_CONFIRM_FIELD}
					name={CAMPAIGN_RULES_CONFIRM_FIELD}
					value={CAMPAIGN_RULES_CONFIRM_VALUE}
					required
					label="Se revisaron estos cambios en las reglas. Quedan registrados en el registro de auditoría y las reglas se congelan al activar la campaña."
					aria-describedby={confirmErrors?.length
						? `rules-changes ${CAMPAIGN_RULES_CONFIRM_FIELD}-error`
						: 'rules-changes'}
					bind:checked={
						() => confirmedFor === changesKey,
						(checked) => {
							confirmedFor = checked ? changesKey : null;
						}
					}
				/>
				{#if confirmErrors?.length}
					<p
						id="{CAMPAIGN_RULES_CONFIRM_FIELD}-error"
						class="m-0 flex items-start gap-1 text-body-sm text-danger-text"
					>
						<Icon name="error" size="sm" class="mt-0.5" />
						<span>{confirmErrors[0]}</span>
					</p>
				{/if}
			</div>

			<div>
				<Button type="submit" loading={submitting} disabled={installmentError}
					>Guardar reglas</Button
				>
			</div>
		</form>
	</div>
</Card>

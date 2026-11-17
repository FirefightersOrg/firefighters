<script lang="ts">
	import { applyAction, enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import FieldError from '$lib/components/campaigns/FieldError.svelte';
	import FormAlert from '$lib/components/campaigns/FormAlert.svelte';
	import {
		cardClass,
		hintClass,
		inputClass,
		labelClass,
		primaryButtonClass,
		secondaryButtonClass
	} from '$lib/components/campaigns/styles';
	import {
		COMMISSION_RULE_TYPE_HINTS,
		COMMISSION_RULE_TYPE_LABELS,
		COMMISSION_RULE_TYPES,
		type CommissionRule
	} from '$lib/domain/commissions';
	import { formatMoneyInput } from '$lib/domain/money';
	import { formatPercentInput } from '$lib/domain/percent';
	import {
		COMMISSION_REASON_MAX_LENGTH,
		type CommissionRuleFieldErrors
	} from '$lib/schemas/commission-rule';

	/**
	 * Create or edit a general commission rule; posts to `?/create` or `?/update`.
	 *
	 * Works without JavaScript: the installment number field (only for "Specific installment")
	 * and the percentage / fixed amount inputs are shown or hidden with CSS `:has()` from the
	 * selected type and value kind, so no client state is needed. The server ignores the hidden
	 * field. With JavaScript, a successful edit returns to the list and keeps the success message.
	 */
	let {
		rule = null,
		installmentCount,
		result = null,
		campaignId
	}: {
		/** The rule being edited, or null to create one. */
		rule?: CommissionRule | null;
		installmentCount: number;
		/** This form's last action result, if any. */
		result?: {
			success: boolean;
			message: string;
			errors: CommissionRuleFieldErrors;
			values?: Record<string, string>;
		} | null;
		/** "Cancel" and a successful edit go back to this campaign's rule list. */
		campaignId: string;
	} = $props();

	const editing = $derived(rule !== null);
	const prefix = $derived(editing ? 'edit' : 'new');
	const errors = $derived(result?.errors ?? {});

	// Initial values: the submitted ones after a failed submit, else the rule's, else defaults.
	const initial = $derived.by(() => {
		const base = rule
			? {
					ruleType: rule.ruleType as string,
					installmentNumber: rule.installmentNumber === null ? '' : String(rule.installmentNumber),
					valueKind: rule.percentage !== null ? 'percentage' : 'fixed_amount',
					percentage: rule.percentage !== null ? formatPercentInput(rule.percentage) : '',
					fixedAmount: rule.fixedAmount !== null ? formatMoneyInput(rule.fixedAmount) : '',
					validFrom: rule.validFrom,
					validTo: rule.validTo ?? '',
					reason: ''
				}
			: {
					ruleType: '',
					installmentNumber: '',
					valueKind: 'percentage',
					percentage: '',
					fixedAmount: '',
					validFrom: '',
					validTo: '',
					reason: ''
				};
		const submitted = result && !result.success ? result.values : undefined;
		if (!submitted) return base;
		const merged: Record<string, string> = { ...base };
		for (const key of Object.keys(base)) {
			if (typeof submitted[key] === 'string') merged[key] = submitted[key];
		}
		return merged as typeof base;
	});

	let submitting = $state(false);
	const fieldId = (name: string) => `${prefix}-${name}`;
	const describedBy = (name: string, hint = false) =>
		[hint ? `${fieldId(name)}-hint` : '', errors[name]?.length ? `${fieldId(name)}-error` : '']
			.filter(Boolean)
			.join(' ') || undefined;
</script>

<section class={cardClass} aria-labelledby="{prefix}-rule-title">
	<h2 id="{prefix}-rule-title" class="mb-4 text-base font-semibold">
		{editing ? 'Edit rule' : 'Add a rule'}
	</h2>
	<form
		method="POST"
		action={editing ? '?/update' : '?/create'}
		class="rule-form space-y-4"
		use:enhance={() => {
			submitting = true;
			return async ({ result: actionResult, update }) => {
				try {
					if (editing && actionResult.type === 'success') {
						// Leave edit mode, then show the success message on the list.
						await goto(resolve('/campaigns/[id]/commissions', { id: campaignId }), {
							invalidateAll: true,
							noScroll: true
						});
						await applyAction(actionResult);
					} else {
						await update();
					}
				} finally {
					submitting = false;
				}
			};
		}}
	>
		{#if result}
			<FormAlert kind={result.success ? 'success' : 'error'} message={result.message} />
		{/if}
		{#if rule}
			<input type="hidden" name="ruleId" value={rule.id} />
		{/if}

		<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
			<div class="sm:col-span-2">
				<label for={fieldId('ruleType')} class={labelClass}>Rule type</label>
				<select
					id={fieldId('ruleType')}
					name="ruleType"
					required
					aria-invalid={errors.ruleType?.length ? 'true' : undefined}
					aria-describedby={describedBy('ruleType', true)}
					class={inputClass}
				>
					<option value="" disabled selected={initial.ruleType === ''}>Choose a type…</option>
					{#each COMMISSION_RULE_TYPES as type (type)}
						<option value={type} selected={initial.ruleType === type}>
							{COMMISSION_RULE_TYPE_LABELS[type]}
						</option>
					{/each}
				</select>
				<p id="{fieldId('ruleType')}-hint" class={hintClass}>
					{#each COMMISSION_RULE_TYPES as type, i (type)}{i > 0 ? ' ' : ''}<span
							><strong>{COMMISSION_RULE_TYPE_LABELS[type]}:</strong>
							{COMMISSION_RULE_TYPE_HINTS[type]}</span
						>{/each}
				</p>
				<FieldError id="{fieldId('ruleType')}-error" errors={errors.ruleType} />
			</div>

			<div class="installment-field">
				<label for={fieldId('installmentNumber')} class={labelClass}>Installment number</label>
				<input
					id={fieldId('installmentNumber')}
					name="installmentNumber"
					type="text"
					inputmode="numeric"
					pattern="[0-9]*"
					autocomplete="off"
					placeholder="1"
					value={initial.installmentNumber}
					aria-invalid={errors.installmentNumber?.length ? 'true' : undefined}
					aria-describedby={describedBy('installmentNumber', true)}
					class={inputClass}
				/>
				<p id="{fieldId('installmentNumber')}-hint" class={hintClass}>
					Only for a specific installment: 1 to {installmentCount}.
				</p>
				<FieldError id="{fieldId('installmentNumber')}-error" errors={errors.installmentNumber} />
			</div>
		</div>

		<fieldset>
			<legend class={labelClass}>Commission</legend>
			<div class="mt-2 flex flex-wrap gap-4 text-sm">
				<label class="inline-flex items-center gap-2">
					<input
						type="radio"
						name="valueKind"
						value="percentage"
						checked={initial.valueKind === 'percentage'}
					/>
					Percentage of the payment
				</label>
				<label class="inline-flex items-center gap-2">
					<input
						type="radio"
						name="valueKind"
						value="fixed_amount"
						checked={initial.valueKind === 'fixed_amount'}
					/>
					Fixed amount per payment
				</label>
			</div>
			<FieldError id="{fieldId('valueKind')}-error" errors={errors.valueKind} />

			<div class="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
				<div class="percentage-field">
					<label for={fieldId('percentage')} class={labelClass}>Percentage (%)</label>
					<input
						id={fieldId('percentage')}
						name="percentage"
						type="text"
						inputmode="decimal"
						autocomplete="off"
						placeholder="12,5"
						value={initial.percentage}
						aria-invalid={errors.percentage?.length ? 'true' : undefined}
						aria-describedby={describedBy('percentage', true)}
						class={inputClass}
					/>
					<p id="{fieldId('percentage')}-hint" class={hintClass}>
						e.g. 25 or 12,5 (comma for decimals, up to 100).
					</p>
					<FieldError id="{fieldId('percentage')}-error" errors={errors.percentage} />
				</div>
				<div class="fixed-field">
					<label for={fieldId('fixedAmount')} class={labelClass}>Fixed amount ($)</label>
					<input
						id={fieldId('fixedAmount')}
						name="fixedAmount"
						type="text"
						inputmode="decimal"
						autocomplete="off"
						placeholder="1.500"
						value={initial.fixedAmount}
						aria-invalid={errors.fixedAmount?.length ? 'true' : undefined}
						aria-describedby={describedBy('fixedAmount', true)}
						class={inputClass}
					/>
					<p id="{fieldId('fixedAmount')}-hint" class={hintClass}>
						In pesos, e.g. 1.500 or 1.500,50.
					</p>
					<FieldError id="{fieldId('fixedAmount')}-error" errors={errors.fixedAmount} />
				</div>
			</div>
		</fieldset>

		<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
			<div>
				<label for={fieldId('validFrom')} class={labelClass}>Valid from</label>
				<input
					id={fieldId('validFrom')}
					name="validFrom"
					type="date"
					required
					value={initial.validFrom}
					aria-invalid={errors.validFrom?.length ? 'true' : undefined}
					aria-describedby={describedBy('validFrom')}
					class={inputClass}
				/>
				<FieldError id="{fieldId('validFrom')}-error" errors={errors.validFrom} />
			</div>
			<div>
				<label for={fieldId('validTo')} class={labelClass}>Valid to (optional)</label>
				<input
					id={fieldId('validTo')}
					name="validTo"
					type="date"
					value={initial.validTo}
					aria-invalid={errors.validTo?.length ? 'true' : undefined}
					aria-describedby={describedBy('validTo', true)}
					class={inputClass}
				/>
				<p id="{fieldId('validTo')}-hint" class={hintClass}>
					Both days included. Leave empty for no end date.
				</p>
				<FieldError id="{fieldId('validTo')}-error" errors={errors.validTo} />
			</div>
			<div>
				<label for={fieldId('reason')} class={labelClass}>Note (optional)</label>
				<input
					id={fieldId('reason')}
					name="reason"
					type="text"
					maxlength={COMMISSION_REASON_MAX_LENGTH}
					value={initial.reason}
					aria-describedby={describedBy('reason', true)}
					class={inputClass}
				/>
				<p id="{fieldId('reason')}-hint" class={hintClass}>Saved in the audit log.</p>
				<FieldError id="{fieldId('reason')}-error" errors={errors.reason} />
			</div>
		</div>

		<p class="text-xs text-slate-500">
			Rules of the same type (and installment) cannot overlap in time. To change a rule from a date
			on, set an end date on the current rule and add a new one starting the next day.
		</p>

		<div class="flex flex-wrap justify-end gap-2">
			{#if editing}
				<a
					href={resolve('/campaigns/[id]/commissions', { id: campaignId })}
					class={secondaryButtonClass}>Cancel</a
				>
			{/if}
			<button type="submit" disabled={submitting} class={primaryButtonClass}>
				{#if submitting}Saving…{:else}{editing ? 'Save rule' : 'Add rule'}{/if}
			</button>
		</div>
	</form>
</section>

<style>
	/* Without JavaScript too: show the installment number only for "Specific installment", and
	   only the value input matching the chosen kind. */
	.installment-field {
		display: none;
	}
	.rule-form:has(:global(select[name='ruleType'] option[value='custom']:checked))
		.installment-field {
		display: block;
	}
	.rule-form:has(:global(input[name='valueKind'][value='percentage']:checked)) .fixed-field {
		display: none;
	}
	.rule-form:has(:global(input[name='valueKind'][value='fixed_amount']:checked)) .percentage-field {
		display: none;
	}
</style>

<script lang="ts">
	import { applyAction, enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		Button,
		Card,
		Field,
		FormResult,
		RadioGroup,
		Select,
		TextInput
	} from '$lib/components/ui';
	import {
		COMMISSION_RULE_TYPE_HINTS_ES,
		COMMISSION_RULE_TYPE_LABELS_ES,
		COMMISSION_RULE_TYPES,
		type CommissionRule
	} from '$lib/domain/commissions';
	import { formatMoneyInput } from '$lib/domain/money';
	import { formatPercentInput } from '$lib/domain/percent';
	import {
		COMMISSION_REASON_MAX_LENGTH,
		COMMISSION_RULE_VERSION_FIELD,
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
		campaignId,
		collectors = []
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
		/** Active collectors; when given, a new rule can target one of them (SAN-69 special rule). */
		collectors?: { id: string; displayName: string }[];
	} = $props();

	const editing = $derived(rule !== null);
	const prefix = $derived(editing ? 'edit' : 'new');
	const errors = $derived(result?.errors ?? {});

	// Initial values: the submitted ones after a failed submit, else the rule's, else defaults.
	// Values and version (`updated_at`) always come from the same load: the page re-mounts this
	// form whenever the edited rule's version changes, and submitted edit values are refilled only
	// when they were based on the loaded version. Values based on an older version are dropped:
	// sending them with the newer version would silently overwrite the newer change.
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
		const failed = result && !result.success ? result.values : undefined;
		const submitted =
			failed && (!rule || failed[COMMISSION_RULE_VERSION_FIELD] === rule.updatedAt)
				? failed
				: undefined;
		if (!submitted) return base;
		const merged: Record<string, string> = { ...base };
		for (const key of Object.keys(base)) {
			if (typeof submitted[key] === 'string') merged[key] = submitted[key];
		}
		return merged as typeof base;
	});

	// The rule version (`updated_at`, exact string) this edit is based on: the loaded rule's, the
	// same load the values above come from. A failed submit does not reload the rule, so a stale
	// form keeps failing with a conflict until the page is reloaded.
	const expectedVersion = $derived(rule?.updatedAt);

	let submitting = $state(false);
	const fieldId = (name: string) => `${prefix}-${name}`;
	const SUMMARY_FIELDS = $derived(
		[
			{ name: 'ruleType', label: 'Tipo de regla' },
			{ name: 'installmentNumber', label: 'Número de cuota' },
			{ name: 'valueKind', label: 'Comisión' },
			{ name: 'percentage', label: 'Porcentaje' },
			{ name: 'fixedAmount', label: 'Monto fijo' },
			{ name: 'validFrom', label: 'Vigente desde' },
			{ name: 'validTo', label: 'Vigente hasta' },
			{ name: 'appliesToCollectorId', label: 'Se aplica a' },
			{ name: 'reason', label: 'Nota' }
		].map((field) => ({ ...field, id: fieldId(field.name) }))
	);
</script>

<Card title={editing ? 'Editar regla' : 'Agregar una regla'} id="{prefix}-rule">
	<form
		method="POST"
		action={editing ? '?/update' : '?/create'}
		class="rule-form flex flex-col gap-5"
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
		<FormResult {result} fields={SUMMARY_FIELDS} />
		{#if rule}
			<input type="hidden" name="ruleId" value={rule.id} />
			<!-- Version the edit is based on (optimistic concurrency): see expectedVersion above. -->
			<input type="hidden" name="expectedUpdatedAt" value={expectedVersion} />
		{/if}

		<div class="grid grid-cols-1 gap-5 sm:grid-cols-3">
			<div class="sm:col-span-2">
				<Field
					label="Tipo de regla"
					id={fieldId('ruleType')}
					hint={COMMISSION_RULE_TYPES.map(
						(type) =>
							`${COMMISSION_RULE_TYPE_LABELS_ES[type]}: ${COMMISSION_RULE_TYPE_HINTS_ES[type]}`
					).join(' ')}
					error={errors.ruleType?.[0]}
					required
				>
					<Select
						name="ruleType"
						placeholder="Elegir un tipo…"
						value={initial.ruleType}
						options={COMMISSION_RULE_TYPES.map((type) => ({
							value: type,
							label: COMMISSION_RULE_TYPE_LABELS_ES[type]
						}))}
					/>
				</Field>
			</div>

			<div class="installment-field">
				<Field
					label="Número de cuota"
					id={fieldId('installmentNumber')}
					hint="Solo para una cuota específica: de 1 a {installmentCount}."
					error={errors.installmentNumber?.[0]}
				>
					<TextInput
						name="installmentNumber"
						type="text"
						inputmode="numeric"
						pattern="[0-9]*"
						autocomplete="off"
						placeholder="1"
						value={initial.installmentNumber}
					/>
				</Field>
			</div>
		</div>

		<RadioGroup
			legend="Comisión"
			name="valueKind"
			defaultValue={initial.valueKind}
			error={errors.valueKind?.[0]}
			options={[
				{ value: 'percentage', label: 'Porcentaje del pago' },
				{ value: 'fixed_amount', label: 'Monto fijo por pago' }
			]}
		/>

		<div class="grid grid-cols-1 gap-5 sm:grid-cols-3">
			<div class="percentage-field">
				<Field
					label="Porcentaje (%)"
					id={fieldId('percentage')}
					hint="Por ejemplo 25 o 12,5 (coma para decimales, hasta 100)."
					error={errors.percentage?.[0]}
				>
					<TextInput
						name="percentage"
						type="text"
						inputmode="decimal"
						autocomplete="off"
						placeholder="12,5"
						value={initial.percentage}
					/>
				</Field>
			</div>
			<div class="fixed-field">
				<Field
					label="Monto fijo ($)"
					id={fieldId('fixedAmount')}
					hint="En pesos, por ejemplo 1.500 o 1.500,50."
					error={errors.fixedAmount?.[0]}
				>
					<TextInput
						name="fixedAmount"
						type="text"
						inputmode="decimal"
						autocomplete="off"
						prefix="$"
						placeholder="1.500"
						value={initial.fixedAmount}
					/>
				</Field>
			</div>
		</div>

		<div class="grid grid-cols-1 gap-5 sm:grid-cols-3">
			<Field label="Vigente desde" id={fieldId('validFrom')} error={errors.validFrom?.[0]} required>
				<TextInput name="validFrom" type="date" value={initial.validFrom} />
			</Field>
			<Field
				label="Vigente hasta"
				id={fieldId('validTo')}
				hint="Ambos días incluidos. Dejarlo vacío si no tiene fecha de fin."
				error={errors.validTo?.[0]}
				optional
			>
				<TextInput name="validTo" type="date" value={initial.validTo} />
			</Field>
			{#if !editing && collectors.length > 0}
				<Field
					label="Se aplica a"
					id={fieldId('appliesToCollectorId')}
					hint="Una regla especial para un cobrador tiene prioridad sobre las reglas generales."
					error={errors.appliesToCollectorId?.[0]}
				>
					<Select
						name="appliesToCollectorId"
						value={result?.values?.appliesToCollectorId ?? ''}
						options={[
							{ value: '', label: 'Todos los cobradores (regla general)' },
							...collectors.map((collector) => ({
								value: collector.id,
								label: collector.displayName
							}))
						]}
					/>
				</Field>
			{/if}
			<Field
				label="Nota"
				id={fieldId('reason')}
				hint="Se guarda en el registro de auditoría."
				error={errors.reason?.[0]}
				optional
			>
				<TextInput
					name="reason"
					type="text"
					maxlength={COMMISSION_REASON_MAX_LENGTH}
					value={initial.reason}
				/>
			</Field>
		</div>

		<p class="m-0 max-w-prose text-body-sm text-muted">
			Las reglas del mismo tipo (y cuota) no pueden superponerse en el tiempo. Para cambiar una
			regla desde una fecha, ponerle fecha de fin a la regla actual y agregar una nueva que empiece
			al día siguiente.
		</p>

		<div class="flex flex-wrap gap-2">
			<Button type="submit" variant="primary" loading={submitting}>
				{editing ? 'Guardar regla' : 'Agregar regla'}
			</Button>
			{#if editing}
				<Button href={resolve('/campaigns/[id]/commissions', { id: campaignId })}>Cancelar</Button>
			{/if}
		</div>
	</form>
</Card>

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

<script lang="ts">
	import { BARCODE_MODE_LABELS, BARCODE_MODES } from '$lib/domain/campaigns';
	import type { CampaignFieldErrors } from '$lib/schemas/campaign';
	import FieldError from './FieldError.svelte';
	import InstallmentFields from './InstallmentFields.svelte';
	import NumberingFields from './NumberingFields.svelte';
	import { inputClass, labelClass } from './styles';
	import type { CampaignRulesValues } from './types';

	/**
	 * Every rule a campaign freezes on activation: installments, numbering and barcode mode, with
	 * the live installment summary and numbering preview.
	 */
	let {
		values = $bindable(),
		errors = {}
	}: {
		values: CampaignRulesValues;
		errors?: CampaignFieldErrors;
	} = $props();
</script>

<div class="space-y-6">
	<fieldset class="space-y-4">
		<legend class="text-sm font-semibold text-slate-900">Price and installments</legend>
		<InstallmentFields
			bind:simpleBondValue={values.simpleBondValue}
			bind:installmentCount={values.installmentCount}
			{errors}
		/>
	</fieldset>

	<NumberingFields
		bind:numberDigits={values.numberDigits}
		bind:maxNumber={values.maxNumber}
		bind:associatedNumberOffset={values.associatedNumberOffset}
		bind:overflowPolicy={values.overflowPolicy}
		{errors}
	/>

	<div>
		<label for="barcodeMode" class={labelClass}>Barcode mode</label>
		<select
			id="barcodeMode"
			name="barcodeMode"
			required
			bind:value={values.barcodeMode}
			aria-invalid={errors.barcodeMode ? 'true' : undefined}
			aria-describedby={errors.barcodeMode ? 'barcodeMode-error' : undefined}
			class={inputClass}
		>
			<option value="" disabled>Choose how scanned barcodes are read…</option>
			{#each BARCODE_MODES as mode (mode)}
				<option value={mode}>{BARCODE_MODE_LABELS[mode]}</option>
			{/each}
		</select>
		<FieldError id="barcodeMode-error" errors={errors.barcodeMode} />
	</div>
</div>

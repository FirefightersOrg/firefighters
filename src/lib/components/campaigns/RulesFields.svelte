<script lang="ts">
	import {
		BARCODE_MODE_LABELS,
		BARCODE_MODES,
		BARCODE_PATTERN_MAX_LENGTH,
		barcodeModeUsesPattern
	} from '$lib/domain/campaigns';
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

	{#if barcodeModeUsesPattern(values.barcodeMode)}
		<div>
			<label for="barcodePattern" class={labelClass}>Barcode pattern (optional)</label>
			<input
				id="barcodePattern"
				name="barcodePattern"
				type="text"
				maxlength={BARCODE_PATTERN_MAX_LENGTH}
				autocomplete="off"
				spellcheck="false"
				placeholder="^BC-(\d+)$"
				bind:value={values.barcodePattern}
				aria-invalid={errors.barcodePattern ? 'true' : undefined}
				aria-describedby={errors.barcodePattern
					? 'barcodePattern-help barcodePattern-error'
					: 'barcodePattern-help'}
				class="{inputClass} font-mono"
			/>
			<p id="barcodePattern-help" class="mt-1 text-xs text-slate-500">
				A regular expression whose first group in parentheses is the base number. Leave it empty to
				type the base number when scanning.
			</p>
			<FieldError id="barcodePattern-error" errors={errors.barcodePattern} />
		</div>
	{/if}
</div>

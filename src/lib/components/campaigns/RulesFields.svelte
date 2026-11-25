<script lang="ts">
	import {
		BARCODE_MODE_LABELS,
		BARCODE_MODES,
		barcodeModeUsesPattern
	} from '$lib/domain/campaigns';
	import { Field, Select, TextInput } from '$lib/components/ui';
	import type { CampaignFieldErrors } from '$lib/schemas/campaign';
	import InstallmentFields from './InstallmentFields.svelte';
	import NumberingFields from './NumberingFields.svelte';
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

<div class="flex flex-col gap-6">
	<fieldset class="m-0 flex flex-col gap-5 border-0 p-0">
		<legend class="mb-3 p-0 text-heading-3 text-text">Precio y cuotas</legend>
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
		bind:associatedNumberMode={values.associatedNumberMode}
		bind:overflowPolicy={values.overflowPolicy}
		{errors}
	/>

	<Field label="Modo de código de barras" id="barcodeMode" error={errors.barcodeMode?.[0]} required>
		<Select
			name="barcodeMode"
			placeholder="Elegir cómo se leen los códigos de barras…"
			options={BARCODE_MODES.map((mode) => ({ value: mode, label: BARCODE_MODE_LABELS[mode] }))}
			bind:value={values.barcodeMode}
		/>
	</Field>

	{#if barcodeModeUsesPattern(values.barcodeMode)}
		<Field
			label="Patrón del código de barras"
			id="barcodePattern"
			hint="Expresión regular cuyo primer grupo entre paréntesis es el número base. Dejarlo vacío para escribir el número base al escanear."
			error={errors.barcodePattern?.[0]}
			optional
		>
			<TextInput
				name="barcodePattern"
				type="text"
				autocomplete="off"
				spellcheck="false"
				mono
				placeholder="^BC-(\d+)$"
				bind:value={values.barcodePattern}
			/>
		</Field>
	{/if}
</div>

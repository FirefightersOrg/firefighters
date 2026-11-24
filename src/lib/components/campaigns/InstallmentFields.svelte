<script lang="ts">
	import { Field, TextInput } from '$lib/components/ui';
	import { formatMoney } from '$lib/format';
	import { previewInstallmentValue } from '$lib/domain/installments';
	import type { CampaignFieldErrors } from '$lib/schemas/campaign';

	/**
	 * Simple bond value (Argentine format, `60.000,50`) + number of installments, with the derived
	 * installment value shown read-only (it is never submitted: the database computes it) and a
	 * live summary ("10 cuotas de $ 6.000"). Shows an inline error while the value does not divide
	 * exactly to the cent; the server rejects it too (same `previewInstallmentValue` rules as the
	 * form schema).
	 */
	let {
		simpleBondValue = $bindable(''),
		installmentCount = $bindable(''),
		errors = {}
	}: {
		simpleBondValue?: string;
		installmentCount?: string;
		errors?: CampaignFieldErrors;
	} = $props();

	const preview = $derived(previewInstallmentValue(simpleBondValue, installmentCount));
	const previewError = $derived(preview.state === 'error' ? preview : null);
	/** Server errors win; otherwise the live preview's problem is shown on its field. */
	const valueError = $derived(
		errors.simpleBondValue?.[0] ??
			(previewError?.field === 'simpleBondValue' ? previewError.message : undefined)
	);
	const countError = $derived(
		errors.installmentCount?.[0] ??
			(previewError?.field === 'installmentCount' ? previewError.message : undefined)
	);
</script>

<div class="grid grid-cols-1 gap-5 sm:grid-cols-3">
	<Field
		label="Valor del bono simple"
		id="simpleBondValue"
		hint="En pesos, por ejemplo 60.000 o 60.000,50 (coma para decimales)."
		error={valueError}
		required
	>
		<TextInput
			name="simpleBondValue"
			type="text"
			inputmode="decimal"
			autocomplete="off"
			prefix="$"
			placeholder="60.000"
			aria-describedby="installment-preview"
			bind:value={simpleBondValue}
		/>
	</Field>

	<Field label="Cantidad de cuotas" id="installmentCount" error={countError} required>
		<TextInput
			name="installmentCount"
			type="text"
			inputmode="numeric"
			pattern="[0-9]*"
			autocomplete="off"
			placeholder="10"
			aria-describedby="installment-preview"
			bind:value={installmentCount}
		/>
	</Field>

	<div class="flex max-w-form flex-col gap-1">
		<span class="text-label text-text" id="installmentValue-label">Valor de la cuota</span>
		<p class="m-0 text-body-sm text-muted">Se calcula: valor ÷ cuotas.</p>
		<output
			for="simpleBondValue installmentCount"
			aria-labelledby="installmentValue-label"
			class="flex min-h-control-md w-full items-center rounded-md border border-dashed border-border-strong bg-surface-sunken px-3 text-input text-text tabular-nums"
		>
			{preview.state === 'ok' ? formatMoney(preview.installmentValue) : '—'}
		</output>
	</div>

	<div id="installment-preview" aria-live="polite" class="text-body-sm sm:col-span-3">
		{#if preview.state === 'ok'}
			<p class="m-0 text-text">
				<strong class="tabular-nums">{preview.installmentCount}</strong>
				{preview.installmentCount === 1 ? 'cuota' : 'cuotas'} de
				<strong class="tabular-nums">{formatMoney(preview.installmentValue)}</strong>
				= <span class="tabular-nums">{formatMoney(preview.simpleBondValue)}</span> (valor del bono simple).
			</p>
		{/if}
	</div>
</div>

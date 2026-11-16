<script lang="ts">
	import { previewInstallmentValue } from '$lib/domain/installments';
	import { formatMoney } from '$lib/domain/money';
	import type { CampaignFieldErrors } from '$lib/schemas/campaign';
	import FieldError from './FieldError.svelte';
	import { hintClass, inputClass, labelClass } from './styles';

	/**
	 * Simple bond value + number of installments, with the derived installment value shown
	 * read-only (it is never submitted: the database computes it). Shows an inline error while the
	 * value does not divide exactly; the server rejects it too.
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
	const countErrors = $derived(errors.installmentCount);
	const countInvalid = $derived(!!countErrors?.length || preview.state === 'error');
</script>

<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
	<div>
		<label for="simpleBondValue" class={labelClass}>Simple bond value</label>
		<input
			id="simpleBondValue"
			name="simpleBondValue"
			type="text"
			inputmode="decimal"
			autocomplete="off"
			required
			placeholder="60000"
			bind:value={simpleBondValue}
			aria-invalid={errors.simpleBondValue ? 'true' : undefined}
			aria-describedby={errors.simpleBondValue ? 'simpleBondValue-error' : 'simpleBondValue-hint'}
			class={inputClass}
		/>
		<p id="simpleBondValue-hint" class={hintClass}>Up to 2 decimals, no thousands separators.</p>
		<FieldError id="simpleBondValue-error" errors={errors.simpleBondValue} />
	</div>

	<div>
		<label for="installmentCount" class={labelClass}>Number of installments</label>
		<input
			id="installmentCount"
			name="installmentCount"
			type="text"
			inputmode="numeric"
			pattern="[0-9]*"
			autocomplete="off"
			required
			placeholder="10"
			bind:value={installmentCount}
			aria-invalid={countInvalid ? 'true' : undefined}
			aria-describedby={countErrors?.length ? 'installmentCount-error' : 'installment-preview'}
			class={inputClass}
		/>
		<FieldError id="installmentCount-error" errors={countErrors} />
	</div>

	<div>
		<span class={labelClass} id="installmentValue-label">Installment value</span>
		<output
			for="simpleBondValue installmentCount"
			aria-labelledby="installmentValue-label"
			class="mt-1 block w-full rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-slate-700 sm:text-sm"
		>
			{preview.state === 'ok' ? formatMoney(preview.installmentValue) : '—'}
		</output>
		<p class={hintClass}>Calculated: value ÷ installments.</p>
	</div>

	<div id="installment-preview" aria-live="polite" class="sm:col-span-3">
		{#if preview.state === 'error' && !countErrors?.length}
			<p class="text-xs text-red-600">{preview.message}</p>
		{/if}
	</div>
</div>

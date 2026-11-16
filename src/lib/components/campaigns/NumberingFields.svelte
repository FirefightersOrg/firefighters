<script lang="ts">
	import type { Snippet } from 'svelte';
	import { OVERFLOW_POLICIES } from '$lib/domain/numbering';
	import { MAX_NUMBER_DIGITS, type CampaignFieldErrors } from '$lib/schemas/campaign';
	import FieldError from './FieldError.svelte';
	import { hintClass, inputClass, labelClass } from './styles';

	/**
	 * Numbering rules: digits, maximum number, associated-number offset and overflow policy.
	 *
	 * Values are the raw input strings, bindable so the parent form (and previews) see every
	 * keystroke. Extension point for SAN-19 (live numbering previews / rule-change warnings):
	 * parse the values with `campaignNumberingSchema` from `$lib/schemas/campaign` and render the
	 * preview through the `preview` snippet (or inline here), using the domain helpers in
	 * `$lib/domain/numbering` (`formatCampaignNumber`, `calculateAssociatedNumber`,
	 * `getMaxValidBaseNumber`).
	 */
	let {
		numberDigits = $bindable(''),
		maxNumber = $bindable(''),
		associatedNumberOffset = $bindable(''),
		overflowPolicy = $bindable('reject'),
		errors = {},
		preview
	}: {
		numberDigits?: string;
		maxNumber?: string;
		associatedNumberOffset?: string;
		overflowPolicy?: string;
		errors?: CampaignFieldErrors;
		preview?: Snippet;
	} = $props();

	const OVERFLOW_POLICY_LABELS: Record<string, string> = {
		reject: 'Reject (block numbers whose associated number exceeds the maximum)'
	};
</script>

<fieldset class="space-y-4">
	<legend class="text-sm font-semibold text-slate-900">Numbering</legend>

	<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
		<div>
			<label for="numberDigits" class={labelClass}>Number of digits</label>
			<input
				id="numberDigits"
				name="numberDigits"
				type="text"
				inputmode="numeric"
				pattern="[0-9]*"
				autocomplete="off"
				required
				bind:value={numberDigits}
				aria-invalid={errors.numberDigits ? 'true' : undefined}
				aria-describedby={errors.numberDigits ? 'numberDigits-error' : 'numberDigits-hint'}
				class={inputClass}
			/>
			<p id="numberDigits-hint" class={hintClass}>
				Visible width, e.g. 4 → 0068 (1-{MAX_NUMBER_DIGITS}).
			</p>
			<FieldError id="numberDigits-error" errors={errors.numberDigits} />
		</div>

		<div>
			<label for="maxNumber" class={labelClass}>Maximum number</label>
			<input
				id="maxNumber"
				name="maxNumber"
				type="text"
				inputmode="numeric"
				pattern="[0-9]*"
				autocomplete="off"
				required
				bind:value={maxNumber}
				aria-invalid={errors.maxNumber ? 'true' : undefined}
				aria-describedby={errors.maxNumber ? 'maxNumber-error' : 'maxNumber-hint'}
				class={inputClass}
			/>
			<p id="maxNumber-hint" class={hintClass}>Highest valid number; must fit in the digits.</p>
			<FieldError id="maxNumber-error" errors={errors.maxNumber} />
		</div>

		<div>
			<label for="associatedNumberOffset" class={labelClass}>Associated number offset</label>
			<input
				id="associatedNumberOffset"
				name="associatedNumberOffset"
				type="text"
				inputmode="numeric"
				pattern="[0-9]*"
				autocomplete="off"
				required
				bind:value={associatedNumberOffset}
				aria-invalid={errors.associatedNumberOffset ? 'true' : undefined}
				aria-describedby={errors.associatedNumberOffset
					? 'associatedNumberOffset-error'
					: 'associatedNumberOffset-hint'}
				class={inputClass}
			/>
			<p id="associatedNumberOffset-hint" class={hintClass}>
				Associated number = base number + offset.
			</p>
			<FieldError id="associatedNumberOffset-error" errors={errors.associatedNumberOffset} />
		</div>
	</div>

	<div>
		<label for="overflowPolicy" class={labelClass}>Overflow policy</label>
		<select
			id="overflowPolicy"
			name="overflowPolicy"
			required
			bind:value={overflowPolicy}
			aria-invalid={errors.overflowPolicy ? 'true' : undefined}
			aria-describedby={errors.overflowPolicy ? 'overflowPolicy-error' : undefined}
			class={inputClass}
		>
			{#each OVERFLOW_POLICIES as policy (policy)}
				<option value={policy}>{OVERFLOW_POLICY_LABELS[policy] ?? policy}</option>
			{/each}
		</select>
		<FieldError id="overflowPolicy-error" errors={errors.overflowPolicy} />
	</div>

	{@render preview?.()}
</fieldset>

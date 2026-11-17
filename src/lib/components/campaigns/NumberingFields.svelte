<script lang="ts">
	import { OVERFLOW_POLICIES } from '$lib/domain/numbering';
	import {
		MAX_NUMBER_DIGITS,
		previewNumberingInput,
		type CampaignFieldErrors
	} from '$lib/schemas/campaign';
	import FieldError from './FieldError.svelte';
	import NumberingPreview from './NumberingPreview.svelte';
	import { hintClass, inputClass, labelClass } from './styles';

	/**
	 * Numbering rules: digits, maximum number, associated-number offset and overflow policy, with a
	 * live preview recomputed on every keystroke (`previewNumberingInput`, the same validation the
	 * server applies on submit). Values are the raw input strings, bindable by the parent form.
	 */
	let {
		numberDigits = $bindable(''),
		maxNumber = $bindable(''),
		associatedNumberOffset = $bindable(''),
		overflowPolicy = $bindable('reject'),
		errors = {}
	}: {
		numberDigits?: string;
		maxNumber?: string;
		associatedNumberOffset?: string;
		overflowPolicy?: string;
		errors?: CampaignFieldErrors;
	} = $props();

	const OVERFLOW_POLICY_LABELS: Record<string, string> = {
		reject: 'Reject (block numbers whose associated number exceeds the maximum)'
	};

	const preview = $derived(
		previewNumberingInput({ numberDigits, maxNumber, associatedNumberOffset, overflowPolicy })
	);
	const previewIssueFields = $derived(
		new Set(preview.state === 'invalid' ? preview.issues.map((issue) => issue.field) : [])
	);

	/** Server errors win; otherwise a problem found by the live preview marks the field invalid. */
	function invalid(field: string): 'true' | undefined {
		return errors[field]?.length || previewIssueFields.has(field) ? 'true' : undefined;
	}

	function describedBy(field: string): string {
		const ids = [`${field}-hint`];
		if (errors[field]?.length) ids.push(`${field}-error`);
		else if (previewIssueFields.has(field)) ids.push(`${field}-preview-error`);
		return ids.join(' ');
	}
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
				aria-invalid={invalid('numberDigits')}
				aria-describedby={describedBy('numberDigits')}
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
				aria-invalid={invalid('maxNumber')}
				aria-describedby={describedBy('maxNumber')}
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
				aria-invalid={invalid('associatedNumberOffset')}
				aria-describedby={describedBy('associatedNumberOffset')}
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
			aria-invalid={invalid('overflowPolicy')}
			aria-describedby={describedBy('overflowPolicy')}
			class={inputClass}
		>
			{#each OVERFLOW_POLICIES as policy (policy)}
				<option value={policy}>{OVERFLOW_POLICY_LABELS[policy] ?? policy}</option>
			{/each}
		</select>
		<p id="overflowPolicy-hint" class={hintClass}>
			What happens when base number + offset exceeds the maximum.
		</p>
		<FieldError id="overflowPolicy-error" errors={errors.overflowPolicy} />
	</div>

	<NumberingPreview {preview} />
</fieldset>

<script lang="ts">
	import { ASSOCIATED_NUMBER_MODE_LABELS, OVERFLOW_POLICY_LABELS } from '$lib/domain/campaigns';
	import { ASSOCIATED_NUMBER_MODES, OVERFLOW_POLICIES } from '$lib/domain/numbering';
	import {
		MAX_NUMBER_DIGITS,
		previewNumberingInput,
		type CampaignFieldErrors
	} from '$lib/schemas/campaign';
	import { Field, Select, TextInput } from '$lib/components/ui';
	import NumberingPreview from './NumberingPreview.svelte';

	/**
	 * Numbering rules: digits, maximum number, associated-number offset and overflow policy, with a
	 * live preview recomputed on every keystroke (`previewNumberingInput`, the same validation the
	 * server applies on submit). Values are the raw input strings, bindable by the parent form.
	 */
	let {
		numberDigits = $bindable(''),
		maxNumber = $bindable(''),
		associatedNumberOffset = $bindable(''),
		associatedNumberMode = $bindable('linear'),
		overflowPolicy = $bindable('reject'),
		errors = {}
	}: {
		numberDigits?: string;
		maxNumber?: string;
		associatedNumberOffset?: string;
		associatedNumberMode?: string;
		overflowPolicy?: string;
		errors?: CampaignFieldErrors;
	} = $props();

	const preview = $derived(
		previewNumberingInput({
			numberDigits,
			maxNumber,
			associatedNumberOffset,
			associatedNumberMode,
			overflowPolicy
		})
	);
	const previewIssueFields = $derived(
		new Set(preview.state === 'invalid' ? preview.issues.map((issue) => issue.field) : [])
	);

	/** A problem found by the live preview marks the field invalid (the list below explains it). */
	function previewInvalid(field: string): true | undefined {
		return previewIssueFields.has(field) ? true : undefined;
	}

	/** The preview's explanation is linked from the field unless a server error replaces it. */
	function previewDescription(field: string): string | undefined {
		return !errors[field]?.length && previewIssueFields.has(field)
			? `${field}-preview-error`
			: undefined;
	}
</script>

<fieldset class="m-0 flex flex-col gap-5 border-0 p-0">
	<legend class="mb-3 p-0 text-heading-3 text-text">Numeración</legend>

	<div class="grid grid-cols-1 gap-5 sm:grid-cols-3">
		<Field
			label="Cantidad de dígitos"
			id="numberDigits"
			hint="Ancho visible: con 4 dígitos, 68 se muestra 0068 (de 1 a {MAX_NUMBER_DIGITS})."
			error={errors.numberDigits?.[0]}
			required
		>
			<TextInput
				name="numberDigits"
				type="text"
				inputmode="numeric"
				pattern="[0-9]*"
				autocomplete="off"
				invalid={previewInvalid('numberDigits')}
				aria-describedby={previewDescription('numberDigits')}
				bind:value={numberDigits}
			/>
		</Field>

		<Field
			label="Número máximo"
			id="maxNumber"
			hint="Mayor número válido; debe entrar en los dígitos."
			error={errors.maxNumber?.[0]}
			required
		>
			<TextInput
				name="maxNumber"
				type="text"
				inputmode="numeric"
				pattern="[0-9]*"
				autocomplete="off"
				invalid={previewInvalid('maxNumber')}
				aria-describedby={previewDescription('maxNumber')}
				bind:value={maxNumber}
			/>
		</Field>

		<Field
			label="Desfase del número asociado"
			id="associatedNumberOffset"
			hint={associatedNumberMode === 'circular'
				? 'Menor que B (la mitad del rango). Número asociado = B + ((base + desfase) mod B).'
				: 'Número asociado = número base + desfase.'}
			error={errors.associatedNumberOffset?.[0]}
			required
		>
			<TextInput
				name="associatedNumberOffset"
				type="text"
				inputmode="numeric"
				pattern="[0-9]*"
				autocomplete="off"
				invalid={previewInvalid('associatedNumberOffset')}
				aria-describedby={previewDescription('associatedNumberOffset')}
				bind:value={associatedNumberOffset}
			/>
		</Field>
	</div>

	<Field
		label="Modo del número asociado"
		id="associatedNumberMode"
		hint="Lineal: número base + desfase. Circular: da la vuelta dentro de la segunda mitad del rango, así los números base y los asociados cubren todo el rango sin repetirse (el número máximo más 1 debe ser par)."
		error={errors.associatedNumberMode?.[0]}
		required
	>
		<Select
			name="associatedNumberMode"
			invalid={previewInvalid('associatedNumberMode')}
			aria-describedby={previewDescription('associatedNumberMode')}
			options={ASSOCIATED_NUMBER_MODES.map((mode) => ({
				value: mode,
				label: ASSOCIATED_NUMBER_MODE_LABELS[mode]
			}))}
			bind:value={associatedNumberMode}
		/>
	</Field>

	<Field
		label="Política de desborde"
		id="overflowPolicy"
		hint="Qué pasa cuando el número base más el desfase supera el máximo."
		error={errors.overflowPolicy?.[0]}
		required
	>
		<Select
			name="overflowPolicy"
			invalid={previewInvalid('overflowPolicy')}
			aria-describedby={previewDescription('overflowPolicy')}
			options={OVERFLOW_POLICIES.map((policy) => ({
				value: policy,
				label: OVERFLOW_POLICY_LABELS[policy]
			}))}
			bind:value={overflowPolicy}
		/>
	</Field>

	<NumberingPreview {preview} />
</fieldset>

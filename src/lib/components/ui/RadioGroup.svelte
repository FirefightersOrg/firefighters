<script lang="ts">
	import { cn } from './cn';

	type RadioOption = {
		value: string;
		label: string;
		description?: string;
		disabled?: boolean;
	};

	let {
		legend,
		options,
		value = $bindable(),
		defaultValue,
		name,
		disabled = false,
		required = false,
		error,
		onchange
	}: {
		legend: string;
		options: RadioOption[];
		value?: string;
		/** Initial value when not bound. */
		defaultValue?: string;
		/** Form field name; generated when omitted so the arrow keys still move within the group. */
		name?: string;
		disabled?: boolean;
		required?: boolean;
		/** Error text shown under the group, linked with aria-describedby. */
		error?: string | null;
		onchange?: (value: string) => void;
	} = $props();

	const uid = $props.id();
	const groupName = $derived(name ?? `radio-${uid}`);
	const errorId = $derived(`radio-${uid}-error`);

	// Not bound: start from `defaultValue`.
	// svelte-ignore state_referenced_locally
	if (value === undefined && defaultValue !== undefined) value = defaultValue;

	function select(next: string) {
		value = next;
		onchange?.(next);
	}
</script>

<!-- Native radios: Tab enters the group, arrow keys move and select, Space selects. -->
<fieldset
	class="m-0 flex flex-col gap-2 border-0 p-0"
	aria-describedby={error ? errorId : undefined}
	{disabled}
>
	<legend class="mb-2 p-0 text-label text-text">{legend}</legend>
	{#each options as option (option.value)}
		{@const optionDisabled = disabled || option.disabled}
		{@const inputId = `${groupName}-${option.value}`}
		<label
			class={cn(
				'flex min-h-control-sm cursor-pointer items-start gap-3 text-body pointer-coarse:min-h-touch',
				optionDisabled && 'cursor-not-allowed text-disabled'
			)}
		>
			<input
				id={inputId}
				type="radio"
				name={groupName}
				value={option.value}
				checked={value === option.value}
				disabled={optionDisabled}
				{required}
				aria-describedby={option.description ? `${inputId}-desc` : undefined}
				onchange={() => select(option.value)}
				class={cn(
					'mt-0.5 grid size-5 shrink-0 cursor-pointer appearance-none place-content-center',
					'rounded-full border-[1.5px] border-border-strong bg-surface',
					'transition-colors duration-[120ms] motion-reduce:transition-none',
					'checked:border-primary checked:bg-primary',
					'checked:after:size-2 checked:after:rounded-full checked:after:bg-on-primary',
					'disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-sunken',
					'disabled:checked:bg-border-strong'
				)}
			/>
			<span>
				<span class="block">{option.label}</span>
				{#if option.description}
					<span
						id="{inputId}-desc"
						class={cn('block text-body-sm', optionDisabled ? 'text-disabled' : 'text-muted')}
						>{option.description}</span
					>
				{/if}
			</span>
		</label>
	{/each}
	{#if error}
		<p id={errorId} class="m-0 text-body-sm text-danger-text">{error}</p>
	{/if}
</fieldset>

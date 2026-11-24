<script lang="ts">
	import type { HTMLSelectAttributes } from 'svelte/elements';
	import Icon from './Icon.svelte';
	import { cn } from './cn';
	import { CONTROL_CLASS } from './control-styles';
	import { getFieldContext, joinIds } from './field-context';

	type Option = string | { value: string; label: string; disabled?: boolean };

	type Props = Omit<HTMLSelectAttributes, 'class' | 'children'> & {
		options?: Option[];
		/** First empty, non-selectable option ("Elegir…"). */
		placeholder?: string;
		/** Only needed outside a `Field`. */
		invalid?: boolean;
		class?: string;
	};

	let {
		value = $bindable(),
		options = [],
		placeholder,
		invalid,
		id,
		disabled,
		class: className,
		'aria-describedby': describedby,
		...rest
	}: Props = $props();

	const field = getFieldContext();
	const isInvalid = $derived(invalid ?? field?.invalid ?? false);
	const normalized = $derived(
		options.map((o) => (typeof o === 'string' ? { value: o, label: o, disabled: false } : o))
	);
</script>

<div class="relative">
	<select
		{...rest}
		id={id ?? field?.id}
		{disabled}
		bind:value
		class={cn(
			CONTROL_CLASS,
			'cursor-pointer appearance-none pr-10 disabled:cursor-not-allowed',
			className
		)}
		aria-invalid={isInvalid ? 'true' : undefined}
		aria-describedby={joinIds(describedby, field?.describedBy)}
		required={rest.required || field?.required || undefined}
	>
		{#if placeholder}
			<option value="" disabled selected={value === undefined || value === ''}>{placeholder}</option
			>
		{/if}
		{#each normalized as option (option.value)}
			<option value={option.value} disabled={option.disabled}>{option.label}</option>
		{/each}
	</select>
	<Icon
		name="chevron-down"
		class={cn(
			'pointer-events-none absolute top-1/2 right-3 -translate-y-1/2',
			disabled ? 'text-disabled' : 'text-muted'
		)}
	/>
</div>

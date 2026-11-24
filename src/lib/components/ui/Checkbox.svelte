<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { cn } from './cn';
	import { joinIds } from './field-context';

	type Props = Omit<HTMLInputAttributes, 'type' | 'class' | 'children'> & {
		label: string;
		description?: string;
		class?: string;
	};

	let {
		label,
		description,
		checked = $bindable(false),
		id,
		disabled,
		class: className,
		'aria-describedby': describedby,
		...rest
	}: Props = $props();

	const uid = $props.id();
	const inputId = $derived(id ?? `checkbox-${uid}`);
	const descId = $derived(`${inputId}-desc`);
</script>

<!-- The whole row (box + text) is the click target. -->
<label
	class={cn(
		'flex min-h-control-sm cursor-pointer items-start gap-3 text-body pointer-coarse:min-h-touch',
		disabled && 'cursor-not-allowed text-disabled',
		className
	)}
>
	<input
		{...rest}
		id={inputId}
		type="checkbox"
		bind:checked
		{disabled}
		aria-describedby={joinIds(describedby, description && descId)}
		class={cn(
			'mt-0.5 grid size-5 shrink-0 cursor-pointer appearance-none place-content-center',
			'rounded-sm border-[1.5px] border-border-strong bg-surface',
			'transition-colors duration-[120ms] motion-reduce:transition-none',
			'checked:border-primary checked:bg-primary',
			'checked:after:h-1.5 checked:after:w-2.5 checked:after:-translate-y-px checked:after:-rotate-45',
			'checked:after:border-b-2 checked:after:border-l-2 checked:after:border-on-primary',
			'disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-sunken',
			'disabled:checked:bg-border-strong'
		)}
	/>
	<span>
		<span class="block">{label}</span>
		{#if description}
			<span id={descId} class={cn('block text-body-sm', disabled ? 'text-disabled' : 'text-muted')}
				>{description}</span
			>
		{/if}
	</span>
</label>

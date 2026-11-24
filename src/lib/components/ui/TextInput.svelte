<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { cn } from './cn';
	import { CONTROL_CLASS } from './control-styles';
	import { getFieldContext, joinIds } from './field-context';

	type Props = Omit<HTMLInputAttributes, 'prefix' | 'class'> & {
		/** Fixed symbol on the left (`$`, `#`). */
		prefix?: string;
		/** Monospace, for codes and serial numbers. */
		mono?: boolean;
		/** Only needed outside a `Field`. */
		invalid?: boolean;
		class?: string;
	};

	let {
		value = $bindable(),
		prefix,
		mono = false,
		invalid,
		id,
		class: className,
		'aria-describedby': describedby,
		...rest
	}: Props = $props();

	const field = getFieldContext();
	const isInvalid = $derived(invalid ?? field?.invalid ?? false);
</script>

<div class="relative flex items-center">
	{#if prefix}
		<span class="pointer-events-none absolute left-3 text-muted" aria-hidden="true">{prefix}</span>
	{/if}
	<input
		{...rest}
		id={id ?? field?.id}
		bind:value
		class={cn(CONTROL_CLASS, mono && 'font-mono text-[15px]', prefix && 'pl-9', className)}
		aria-invalid={isInvalid ? 'true' : undefined}
		aria-describedby={joinIds(describedby, field?.describedBy)}
		required={rest.required || field?.required || undefined}
	/>
</div>

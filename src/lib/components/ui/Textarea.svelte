<script lang="ts">
	import type { HTMLTextareaAttributes } from 'svelte/elements';
	import { cn } from './cn';
	import { CONTROL_CLASS } from './control-styles';
	import { getFieldContext, joinIds } from './field-context';

	type Props = Omit<HTMLTextareaAttributes, 'class'> & {
		/** Only needed outside a `Field`. */
		invalid?: boolean;
		class?: string;
	};

	let {
		value = $bindable(),
		invalid,
		id,
		class: className,
		'aria-describedby': describedby,
		...rest
	}: Props = $props();

	const field = getFieldContext();
	const isInvalid = $derived(invalid ?? field?.invalid ?? false);
</script>

<textarea
	{...rest}
	id={id ?? field?.id}
	bind:value
	class={cn(CONTROL_CLASS, 'min-h-24 resize-y', className)}
	aria-invalid={isInvalid ? 'true' : undefined}
	aria-describedby={joinIds(describedby, field?.describedBy)}
	required={rest.required || field?.required || undefined}></textarea>

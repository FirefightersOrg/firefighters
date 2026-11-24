<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';
	import { setFieldContext } from './field-context';

	let {
		label,
		hint,
		error,
		optional = false,
		required = false,
		id: idProp,
		children
	}: {
		label: string;
		hint?: string;
		/** First error message, e.g. `errors.name?.[0]` from a form action. */
		error?: string | null;
		optional?: boolean;
		required?: boolean;
		/** Id for the control; generated when omitted. */
		id?: string;
		children: Snippet;
	} = $props();

	const uid = $props.id();
	const id = $derived(idProp ?? `field-${uid}`);
	const hintId = $derived(`${id}-hint`);
	const errorId = $derived(`${id}-error`);

	setFieldContext({
		get id() {
			return id;
		},
		get describedBy() {
			const ids = [hint ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ');
			return ids || undefined;
		},
		get invalid() {
			return !!error;
		},
		get required() {
			return required;
		}
	});
</script>

<div class="flex max-w-form flex-col gap-1">
	<label for={id} class="text-label text-text">
		{label}{#if optional}<span class="font-normal text-muted"> (opcional)</span>{/if}
	</label>
	{#if hint}
		<p id={hintId} class="m-0 text-body-sm text-muted">{hint}</p>
	{/if}
	{@render children()}
	{#if error}
		<p id={errorId} class="m-0 flex items-start gap-1 text-body-sm text-danger-text">
			<Icon name="error" size="sm" class="mt-0.5" />
			<span>{error}</span>
		</p>
	{/if}
</div>

<script lang="ts">
	// Test-only: renders a Field around each kind of control.
	import Field from '../Field.svelte';
	import TextInput from '../TextInput.svelte';
	import Select from '../Select.svelte';
	import Textarea from '../Textarea.svelte';

	let {
		control,
		hint,
		error,
		optional,
		required
	}: {
		control: 'text' | 'select' | 'textarea';
		hint?: string;
		error?: string;
		optional?: boolean;
		required?: boolean;
	} = $props();
</script>

<Field label="Nombre" {hint} {error} {optional} {required} id="f1">
	{#if control === 'text'}
		<TextInput name="name" />
	{:else if control === 'select'}
		<Select name="name" options={['a', 'b']} placeholder="Elegir…" />
	{:else}
		<Textarea name="name" />
	{/if}
</Field>

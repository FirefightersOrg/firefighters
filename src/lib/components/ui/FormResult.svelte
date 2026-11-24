<script lang="ts">
	import Alert from './Alert.svelte';
	import FormErrorSummary from './FormErrorSummary.svelte';

	/**
	 * The outcome of a form action, shown above the form: success `Alert`, the field-error summary
	 * (links + focus on the first invalid field) when fields failed, or a plain error `Alert`.
	 */
	let {
		result,
		fields
	}: {
		result?: {
			success: boolean;
			message?: string;
			errors?: Record<string, string[] | undefined>;
		} | null;
		fields: { name: string; label: string; id?: string }[];
	} = $props();

	const errors = $derived(result?.errors ?? {});
	const hasFieldErrors = $derived(fields.some((field) => errors[field.name]?.length));
</script>

{#if result}
	{#if result.success}
		<Alert tone="success">{result.message}</Alert>
	{:else if hasFieldErrors}
		<FormErrorSummary {errors} {fields} title={result.message || undefined} />
	{:else if result.message}
		<Alert tone="danger">{result.message}</Alert>
	{/if}
{/if}

<script lang="ts">
	import { tick } from 'svelte';
	import Alert from './Alert.svelte';

	/**
	 * Summary `Alert` for a form that was submitted with errors: one link per invalid field, and
	 * the focus goes to the first invalid field. `errors` is the `{ field: [messages] }` shape of a
	 * form action; `fields` lists the fields in page order with their label and control id.
	 * Renders nothing without field errors.
	 */
	let {
		errors,
		fields,
		title = 'Revisar los datos ingresados'
	}: {
		errors: Record<string, string[] | undefined>;
		/** Fields in page order: `name` as it appears in `errors`, visible `label`, control `id`. */
		fields: { name: string; label: string; id?: string }[];
		title?: string;
	} = $props();

	const items = $derived(
		fields
			.filter((field) => errors[field.name]?.length)
			.map((field) => ({
				id: field.id ?? field.name,
				label: field.label,
				message: errors[field.name]![0]
			}))
	);
	const signature = $derived(items.map((item) => `${item.id}:${item.message}`).join('|'));

	function focusField(id: string) {
		const element = document.getElementById(id);
		if (!element) return;
		element.scrollIntoView({ block: 'center' });
		element.focus({ preventScroll: true });
	}

	let lastFocused = '';
	$effect(() => {
		const current = signature;
		if (!current || current === lastFocused) return;
		lastFocused = current;
		void tick().then(() => focusField(items[0].id));
	});
</script>

{#if items.length}
	<Alert tone="danger" {title}>
		<ul class="m-0 list-disc pl-5">
			{#each items as item (item.id)}
				<li>
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- in-page anchor -->
					<a
						href="#{item.id}"
						class="rounded-sm text-danger-text underline underline-offset-2"
						onclick={(event) => {
							event.preventDefault();
							focusField(item.id);
						}}>{item.label}</a
					>: {item.message}
				</li>
			{/each}
		</ul>
	</Alert>
{/if}

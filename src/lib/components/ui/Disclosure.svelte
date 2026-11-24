<script lang="ts">
	import type { Snippet } from 'svelte';
	import Glyph from './Glyph.svelte';

	/**
	 * Collapsible block built on `<details>`: works without JavaScript and with the keyboard.
	 * `aria-expanded` mirrors the open state on the summary for assistive tech. Never hide
	 * errors or mandatory actions inside.
	 */
	let {
		summary,
		meta,
		defaultOpen = false,
		children
	}: { summary: string; meta?: string; defaultOpen?: boolean; children: Snippet } = $props();

	// The initial value is intentional: `defaultOpen` only seeds the state.
	// svelte-ignore state_referenced_locally
	let open = $state(defaultOpen);
</script>

<details
	class="group rounded-md border border-border bg-surface"
	{open}
	ontoggle={(event) => (open = event.currentTarget.open)}
>
	<summary
		class="flex min-h-touch cursor-pointer list-none items-center gap-2 rounded-md px-4 text-label hover:bg-surface-hover [&::-webkit-details-marker]:hidden"
		aria-expanded={open}
	>
		<span class="text-muted transition-transform group-open:rotate-180"
			><Glyph name="chevron-down" /></span
		>
		{summary}
		{#if meta}<span class="ml-auto font-normal text-muted">{meta}</span>{/if}
	</summary>
	<div class="px-4 pb-4">{@render children()}</div>
</details>

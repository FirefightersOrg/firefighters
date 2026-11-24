<script lang="ts">
	import type { Snippet } from 'svelte';
	import Glyph from './Glyph.svelte';

	/** What a list or search shows without content: what is missing plus how to start. */
	let {
		title,
		icon = 'inbox',
		actions,
		children
	}: {
		title: string;
		icon?: 'inbox' | 'search';
		actions?: Snippet;
		children?: Snippet;
	} = $props();
</script>

<div class="flex flex-col items-center gap-2 px-6 py-10 text-center">
	<span class="mb-2 grid size-12 place-items-center rounded-full bg-surface-sunken text-muted">
		<Glyph name={icon} />
	</span>
	<p class="m-0 text-heading-3">{title}</p>
	{#if children}<div class="max-w-[44ch] text-muted">{@render children()}</div>{/if}
	{#if actions}<div class="mt-3 flex gap-2">{@render actions()}</div>{/if}
</div>

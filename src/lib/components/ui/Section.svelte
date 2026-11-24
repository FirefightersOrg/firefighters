<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Numbered card with an anchor ("3. Barcode") for long records. `id` is the `#id` target of
	 * the page index; the number keeps a fixed order between records.
	 */
	let {
		id,
		number,
		title,
		actions,
		children
	}: {
		id: string;
		number?: number;
		title: string;
		actions?: Snippet;
		children: Snippet;
	} = $props();
</script>

<section
	{id}
	class="scroll-mt-20 rounded-lg border border-border bg-surface shadow-sm"
	aria-labelledby="{id}-title"
>
	<header
		class="flex items-start justify-between gap-4 border-b border-border px-4 py-3 sm:px-6 sm:py-4"
	>
		<h2 id="{id}-title" class="m-0 flex items-baseline gap-2 text-heading-3">
			{#if number !== undefined}<span class="text-subtle tabular-nums">{number}.</span>{/if}
			{title}
		</h2>
		{#if actions}<div class="flex gap-2">{@render actions()}</div>{/if}
	</header>
	<div class="p-4 sm:p-6">{@render children()}</div>
</section>

<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * A list of records as rows instead of a table: what a list is below 720px, and what a short list
	 * inside a record is at any width. Put `Row` items inside.
	 */
	let {
		label,
		children,
		empty
	}: {
		/** Accessible name of the list («Pagos de esta rendición»). */
		label: string;
		children: Snippet;
		/** Shown instead of the list when it has no rows, typically an `EmptyState`. */
		empty?: Snippet;
	} = $props();
</script>

{#if empty}
	{@render empty()}
{:else}
	<ul class="m-0 list-none p-0" aria-label={label} data-row-list>
		{@render children()}
	</ul>
{/if}

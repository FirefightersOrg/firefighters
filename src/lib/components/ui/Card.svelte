<script lang="ts">
	import type { Snippet } from 'svelte';

	/** Container for one block of related content on `surface`. Do not nest cards. */
	let {
		title,
		description,
		actions,
		footer,
		flush = false,
		as: tag = 'section',
		id,
		children
	}: {
		title?: string;
		description?: string;
		actions?: Snippet;
		footer?: Snippet;
		flush?: boolean;
		as?: string;
		id?: string;
		children?: Snippet;
	} = $props();

	const titleId = $derived(id && title ? `${id}-title` : undefined);
</script>

<svelte:element
	this={tag}
	{id}
	class="rounded-lg border border-border bg-surface shadow-sm"
	aria-labelledby={titleId}
>
	{#if title || description || actions}
		<header
			class="flex items-start justify-between gap-4 border-b border-border px-4 py-3 sm:px-6 sm:py-4"
		>
			<div>
				{#if title}<h2 id={titleId} class="m-0 text-heading-3">{title}</h2>{/if}
				{#if description}<p class="m-0 text-body-sm text-muted">{description}</p>{/if}
			</div>
			{#if actions}<div class="flex gap-2">{@render actions()}</div>{/if}
		</header>
	{/if}
	{#if children}
		<div class={flush ? '' : 'p-4 sm:p-6'}>{@render children()}</div>
	{/if}
	{#if footer}
		<footer
			class="flex gap-2 rounded-b-lg border-t border-border bg-surface-sunken px-4 py-3 sm:px-6 sm:py-4"
		>
			{@render footer()}
		</footer>
	{/if}
</svelte:element>

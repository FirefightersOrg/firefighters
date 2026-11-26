<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * One row of a `RowList`: two lines. The first says what it is (an identifier and the main fact),
	 * the second its state or detail; an amount or a badge sits at the end. With `href` the whole row
	 * is the link (one tab stop, 56px tall), and `actions` stay clickable above it.
	 */
	let {
		title,
		detail,
		href,
		lead,
		meta,
		trailing,
		actions
	}: {
		/** First line: the main fact (a name, «Cuota 3 de 6»). */
		title: string;
		/** Second line, plain text. Use `meta` instead for badges. */
		detail?: string;
		/** Makes the whole row a link. Resolved by the caller. */
		href?: string;
		/** Before the text: the identifier, usually a `BondNumber`. */
		lead?: Snippet;
		/** Second line with rich content (badges). Replaces `detail`. */
		meta?: Snippet;
		/** At the end: an amount or a status. */
		trailing?: Snippet;
		/** Row controls (`RowActions`): they stay above the row link. */
		actions?: Snippet;
	} = $props();
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- hrefs are resolved by the caller -->
<li
	class="relative flex min-h-14 items-center gap-3 border-b border-border py-2.5 {href
		? 'hover:bg-surface-hover'
		: ''}"
	data-row
>
	{#if lead}<div class="shrink-0">{@render lead()}</div>{/if}
	<div class="min-w-0 flex-1">
		{#if href}
			<a
				{href}
				class="block truncate rounded-sm text-body font-medium text-text after:absolute after:inset-0 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
				>{title}</a
			>
		{:else}
			<p class="m-0 truncate text-body font-medium text-text">{title}</p>
		{/if}
		{#if meta}
			<div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-muted">
				{@render meta()}
			</div>
		{:else if detail}
			<p class="m-0 truncate text-body-sm text-muted">{detail}</p>
		{/if}
	</div>
	{#if trailing}<div class="shrink-0 text-right">{@render trailing()}</div>{/if}
	<!-- Positioned after the link, so it paints above the row link without a z-index of its own: an
	     open menu inside it can then rise above the rows that follow. -->
	{#if actions}<div class="relative shrink-0">{@render actions()}</div>{/if}
	{#if href && !actions}
		<svg
			class="shrink-0 text-subtle"
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d="m9 6 6 6-6 6" />
		</svg>
	{/if}
</li>

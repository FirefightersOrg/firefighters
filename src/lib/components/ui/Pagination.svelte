<script lang="ts">
	import { formatNumber } from '$lib/format';
	import Button from './Button.svelte';

	/**
	 * Previous / next links for a paged list, with «Página X de Y» between them. A `nav` landmark with
	 * its own name; the buttons are links (they work without JavaScript, every page has its URL) and
	 * reach 44px on touch screens like every `Button`. Renders nothing with a single page, unless the
	 * URL asks for a page past the first (so the way back stays).
	 */
	let {
		page,
		pageCount,
		hrefFor,
		label = 'Paginación'
	}: {
		page: number;
		pageCount: number;
		/** Link for a page number; the caller builds it from the resolved list path. */
		hrefFor: (page: number) => string;
		/** Name of the landmark, when the page has more than one paged list. */
		label?: string;
	} = $props();
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- hrefs are resolved by the caller -->
{#if pageCount > 1 || page > 1}
	<nav aria-label={label} class="flex items-center justify-between gap-3 text-body-sm">
		{#if page > 1}
			<Button href={hrefFor(page - 1)} rel="prev">Anterior</Button>
		{:else}
			<span></span>
		{/if}
		<span class="text-muted tabular-nums" aria-current="page"
			>Página {formatNumber(page)} de {formatNumber(pageCount)}</span
		>
		{#if page < pageCount}
			<Button href={hrefFor(page + 1)} rel="next">Siguiente</Button>
		{:else}
			<span></span>
		{/if}
	</nav>
{/if}

<script lang="ts">
	import { Button } from '$lib/components/ui';

	/** Previous / next links for a paged list; renders nothing with a single page. */
	let {
		page,
		pageCount,
		hrefFor
	}: {
		page: number;
		pageCount: number;
		/** Link for a page number; the caller builds it from the resolved list path. */
		hrefFor: (page: number) => string;
	} = $props();
</script>

{#if pageCount > 1}
	<nav aria-label="Paginación" class="mt-4 flex items-center justify-between gap-3">
		{#if page > 1}
			<Button href={hrefFor(page - 1)}>← Anterior</Button>
		{:else}
			<span></span>
		{/if}
		<span class="text-body-sm text-muted tabular-nums">Página {page} de {pageCount}</span>
		{#if page < pageCount}
			<Button href={hrefFor(page + 1)}>Siguiente →</Button>
		{:else}
			<span></span>
		{/if}
	</nav>
{/if}

<script lang="ts">
	import { Button } from '$lib/components/ui';

	/** Previous/next links for a portal list. `path` is the list's own path (no query). */
	let {
		page,
		pageCount,
		path,
		label
	}: { page: number; pageCount: number; path: string; label: string } = $props();

	const link = (target: number) => (target > 1 ? `${path}?page=${target}` : path);
</script>

{#if pageCount > 1}
	<nav aria-label={label} class="flex items-center justify-between text-body">
		<span>Página {page} de {pageCount}</span>
		<span class="flex gap-2">
			{#if page > 1}<Button href={link(page - 1)}>Anterior</Button>{/if}
			{#if page < pageCount}<Button href={link(page + 1)}>Siguiente</Button>{/if}
		</span>
	</nav>
{/if}

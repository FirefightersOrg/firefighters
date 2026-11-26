<script lang="ts">
	import type { Snippet } from 'svelte';
	import { BOND_RECORD_SECTIONS, type BondRecordSectionId } from './types';

	/**
	 * A titled block of the bond record's reference data. It used to be a numbered card with an
	 * index at the top of the page; since the redesign (UX plan PR 8) these blocks live inside the
	 * record's collapsed groups, so they are plain: a small title and the content. The `id` stays as
	 * an anchor.
	 */
	let { id, children }: { id: BondRecordSectionId; children: Snippet } = $props();

	const title = $derived(BOND_RECORD_SECTIONS.find((section) => section.id === id)?.title ?? '');
</script>

<section {id} class="scroll-mt-20" aria-labelledby="{id}-title">
	<h3 id="{id}-title" class="m-0 mb-2 text-label text-muted">{title}</h3>
	{@render children()}
</section>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cardClass } from '$lib/components/campaigns/styles';
	import { BOND_RECORD_SECTIONS, type BondRecordSectionId } from './types';

	/**
	 * A numbered card of the bond record ("3. Barcode"), with an anchor (`#barcode`) for the
	 * section index at the top of the page.
	 */
	let { id, children }: { id: BondRecordSectionId; children: Snippet } = $props();

	const index = $derived(BOND_RECORD_SECTIONS.findIndex((s) => s.id === id));
	const title = $derived(BOND_RECORD_SECTIONS[index].title);
</script>

<section {id} class="{cardClass} scroll-mt-4" aria-labelledby="{id}-title">
	<h2 id="{id}-title" class="mb-4 text-base font-semibold">
		<span class="text-slate-400 tabular-nums">{index + 1}.</span>
		{title}
	</h2>
	{@render children()}
</section>

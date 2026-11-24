<script lang="ts">
	import type { Snippet } from 'svelte';
	import Section from '$lib/components/ui/Section.svelte';
	import { BOND_RECORD_SECTIONS, type BondRecordSectionId } from './types';

	/**
	 * A numbered card of the bond record ("3. Barcode"), with an anchor (`#barcode`) for the
	 * section index at the top of the page. Number and title come from BOND_RECORD_SECTIONS.
	 */
	let { id, children }: { id: BondRecordSectionId; children: Snippet } = $props();

	const index = $derived(BOND_RECORD_SECTIONS.findIndex((s) => s.id === id));
	const title = $derived(BOND_RECORD_SECTIONS[index].title);
</script>

<Section {id} number={index + 1} {title}>
	{@render children()}
</Section>

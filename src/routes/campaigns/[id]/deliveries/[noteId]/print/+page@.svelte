<script lang="ts">
	import DeliveryNoteSheet from '$lib/components/documents/DeliveryNoteSheet.svelte';
	import type { PageProps } from './$types';

	/** Printable bond delivery note; `+page@` resets to the root layout so no app navigation prints. */
	let { data }: PageProps = $props();
</script>

<DeliveryNoteSheet document={data.document} />

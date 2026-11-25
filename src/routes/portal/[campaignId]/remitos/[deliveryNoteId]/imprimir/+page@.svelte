<script lang="ts">
	import DeliveryNoteSheet from '$lib/components/documents/DeliveryNoteSheet.svelte';
	import type { PageProps } from './$types';

	/** Printable own delivery note of the collector portal (SAN-153): same sheet as the operator route. */
	let { data }: PageProps = $props();
</script>

<DeliveryNoteSheet document={data.document} />

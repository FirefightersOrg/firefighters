<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import ErrorMessage from '$lib/components/layout/ErrorMessage.svelte';
	import { institutionName } from '$lib/institution';

	// Errors in the collector portal, under the portal's header.
</script>

<svelte:head><title>Error {page.status} - {institutionName()}</title></svelte:head>

<ErrorMessage
	status={page.status}
	error={page.error}
	retryHref={page.url.pathname + page.url.search}
	back={[{ label: 'Ir a mi portal', href: resolve('/portal') }]}
/>

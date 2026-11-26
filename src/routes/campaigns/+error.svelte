<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import ErrorMessage from '$lib/components/layout/ErrorMessage.svelte';
	import { institutionName } from '$lib/institution';

	// Errors on the campaign list and on «Nueva campaña», under the plain header of the layout.
</script>

<svelte:head><title>Error {page.status} - {institutionName()}</title></svelte:head>

<ErrorMessage
	status={page.status}
	error={page.error}
	retryHref={page.url.pathname + page.url.search}
	back={[{ label: 'Ir a las campañas', href: resolve('/campaigns') }]}
/>

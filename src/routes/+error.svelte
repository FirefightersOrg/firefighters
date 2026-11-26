<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import AppNav from '$lib/components/layout/AppNav.svelte';
	import ErrorMessage from '$lib/components/layout/ErrorMessage.svelte';
	import { institutionName } from '$lib/institution';

	// Errors outside a campaign and outside the portal (and any error thrown by a layout load).
	const permissions = $derived(page.data.permissions ?? []);
	const back = $derived(
		!page.data.profile
			? [{ label: 'Iniciar sesión', href: resolve('/login') }]
			: [
					...(permissions.includes('campaign.view')
						? [{ label: 'Ir a las campañas', href: resolve('/campaigns') }]
						: []),
					...(permissions.includes('bond.view_own')
						? [{ label: 'Ir a mi portal', href: resolve('/portal') }]
						: []),
					...(permissions.includes('campaign.view') || permissions.includes('bond.view_own')
						? []
						: [{ label: 'Ir al inicio', href: resolve('/') }])
				]
	);
</script>

<svelte:head><title>Error {page.status} - {institutionName()}</title></svelte:head>

{#if page.data.profile}
	<AppNav fullName={page.data.profile.full_name} {permissions} />
{/if}
<main class="mx-auto max-w-content px-4 py-8 sm:px-6">
	<ErrorMessage
		status={page.status}
		error={page.error}
		retryHref={page.url.pathname + page.url.search}
		{back}
	/>
</main>

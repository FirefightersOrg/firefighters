<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import ErrorMessage from '$lib/components/layout/ErrorMessage.svelte';
	import { institutionName } from '$lib/institution';
	import { campaignNav } from '$lib/navigation';

	/**
	 * Errors inside a campaign. They render in the campaign shell, so the sections stay one tap away.
	 * The way back is the list of the section the address belongs to, then the campaign's home.
	 */
	const shell = $derived(page.data.shell ?? null);
	const section = $derived(
		shell
			? campaignNav(page.data.permissions ?? [], shell.campaign.id, page.url.pathname).current
			: null
	);
	const back = $derived(
		shell
			? [
					...(section && section.key !== 'home' && page.url.pathname !== section.path
						? [
								{
									label: `Volver a ${section.label}`,
									href: resolve(section.route, { id: shell.campaign.id })
								}
							]
						: []),
					{
						label: 'Ir al inicio de la campaña',
						href: resolve('/campaigns/[id]', { id: shell.campaign.id })
					}
				]
			: [{ label: 'Ir a las campañas', href: resolve('/campaigns') }]
	);
</script>

<svelte:head><title>Error {page.status} - {institutionName()}</title></svelte:head>

<ErrorMessage
	status={page.status}
	error={page.error}
	retryHref={page.url.pathname + page.url.search}
	{back}
/>

<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import PortalNav from '$lib/components/portal/PortalNav.svelte';
	import { setPageHeaderRoots } from '$lib/components/ui/page-header-context';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	// The portal's navigation already links to its home: page headers do not repeat it.
	setPageHeaderRoots(() => [resolve('/portal')]);
</script>

<PortalNav
	campaignId={data.campaign.id}
	campaignName={data.campaign.name}
	permissions={data.permissions}
	pathname={page.url.pathname}
/>

{@render children()}

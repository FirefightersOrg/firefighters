<script lang="ts">
	import { page } from '$app/state';
	import PortalNav from '$lib/components/portal/PortalNav.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
</script>

<PortalNav
	campaignId={data.campaign.id}
	campaignName={data.campaign.name}
	permissions={data.permissions}
	pathname={page.url.pathname}
/>

{@render children()}

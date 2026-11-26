<script lang="ts">
	import { page } from '$app/state';
	import AppNav from '$lib/components/layout/AppNav.svelte';
	import CampaignShell from '$lib/components/layout/CampaignShell.svelte';
	import { institutionName } from '$lib/institution';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
</script>

{#if data.shell}
	<CampaignShell
		institution={institutionName()}
		campaign={data.shell.campaign}
		fullName={data.profile?.full_name}
		permissions={data.permissions}
		pathname={page.url.pathname}
		openSettlements={data.shell.openSettlements}
	>
		{@render children()}
	</CampaignShell>
{:else}
	<!-- The campaign could not be loaded: the page (or the error page) renders under the plain header. -->
	<AppNav fullName={data.profile?.full_name} permissions={data.permissions} />
	<main class="mx-auto max-w-content px-4 py-8 sm:px-6">
		{@render children()}
	</main>
{/if}

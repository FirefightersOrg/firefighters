<script lang="ts">
	import { page } from '$app/state';
	import AppNav from '$lib/components/layout/AppNav.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	// Inside a campaign the shell (campaigns/[id]/+layout.svelte) brings its own header and navigation.
	const inCampaign = $derived(!!page.params.id);
</script>

{#if inCampaign}
	{@render children()}
{:else}
	<AppNav fullName={data.profile?.full_name} permissions={data.permissions} />

	<main class="mx-auto max-w-content px-4 py-8 sm:px-6">
		{@render children()}
	</main>
{/if}

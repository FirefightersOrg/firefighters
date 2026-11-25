<script lang="ts">
	import AppNav from '$lib/components/layout/AppNav.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
</script>

<AppNav fullName={data.profile?.full_name} permissions={data.permissions} />

<main class="mx-auto max-w-content px-4 py-8 sm:px-6">
	{@render children()}
</main>

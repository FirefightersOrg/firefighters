<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import AppHeader from '$lib/components/ui/AppHeader.svelte';
	import { mainNavItems } from '$lib/navigation';

	/** The signed-in app shell header: main navigation by permission, person and «Cerrar sesión». */
	let {
		fullName,
		permissions
	}: {
		fullName?: string | null;
		permissions: readonly string[];
	} = $props();

	const links = $derived(
		mainNavItems(permissions, page.url.pathname).map((item) => ({
			label: item.label,
			href: resolve(item.path),
			current: item.current
		}))
	);
</script>

<AppHeader
	product="Firefighters"
	homeHref={resolve('/')}
	{links}
	user={fullName ?? undefined}
	logoutAction={resolve('/logout')}
/>

<script lang="ts">
	import { resolve } from '$app/paths';
	import { portalNavItems } from '$lib/portal/nav';

	/** Sub-navigation shared by every page of a campaign inside the collector portal. */
	let {
		campaignId,
		campaignName,
		permissions,
		pathname
	}: {
		campaignId: string;
		campaignName: string;
		permissions: readonly string[];
		pathname: string;
	} = $props();

	const items = $derived(portalNavItems(permissions, campaignId, pathname));
	const linkClass =
		'inline-flex min-h-touch items-center rounded-md px-3 text-label text-muted hover:bg-surface-hover hover:text-text aria-[current=page]:bg-primary-soft aria-[current=page]:text-primary-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
</script>

<nav aria-label={`Portal del cobrador, ${campaignName}`} class="mb-6 border-b border-border pb-3">
	<p class="m-0 mb-2 text-body-sm text-muted">
		Campaña: <a
			class="rounded-sm text-primary-text underline-offset-2 hover:underline"
			href={resolve('/portal')}>{campaignName}</a
		>
	</p>
	<ul class="m-0 flex list-none flex-wrap gap-1 p-0">
		{#each items as item (item.section)}
			<li>
				<a
					class={linkClass}
					href={resolve(`/portal/[campaignId]/${item.section}`, { campaignId })}
					aria-current={item.current ? 'page' : undefined}>{item.label}</a
				>
			</li>
		{/each}
	</ul>
</nav>

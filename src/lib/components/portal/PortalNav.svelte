<script lang="ts">
	import { resolve } from '$app/paths';
	import { portalNavItems, type PortalSection } from '$lib/portal/nav';

	/**
	 * The portal's navigation inside a campaign (UX plan PR 10): the same five links are a strip of
	 * tabs above the page from 1024px and a bar fixed at the bottom of the screen on a phone, within
	 * reach of the thumb, with «Por cobrar» first. One `<nav>`, so the links and their names are the
	 * same for assistive tech at every width. A page with a `TaskBar` hides the bar (see `app.css`).
	 */
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

	/** Stroke icons (24px grid), the same drawing language as the campaign shell. */
	const ICONS: Record<PortalSection, string> = {
		'por-cobrar': 'M3 6h18v12H3zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
		bonos: 'M4 7h16v10H4zM9 7v10',
		ventas: 'M6 4h12v16l-3-2-3 2-3-2-3 2z',
		compradores: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0',
		cuenta: 'M5 6h14M5 12h14M5 18h9'
	};
	const link =
		'flex min-h-14 w-full flex-col items-center justify-center gap-0.5 border-t-[3px] px-1 text-caption no-underline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus lg:min-h-touch lg:w-auto lg:flex-row lg:border-t-0 lg:border-b-[3px] lg:px-3 lg:text-label lg:hover:text-text';
	// One or the other: two border colours on the same element would leave the result to CSS order.
	const current = 'border-accent font-semibold text-text';
	const idle = 'border-transparent text-muted';
</script>

<p class="m-0 mb-2 text-body-sm text-muted">
	Campaña: <a
		class="rounded-sm text-primary-text underline-offset-2 hover:underline"
		href={resolve('/portal')}>{campaignName}</a
	>
</p>
<nav
	aria-label={`Portal del cobrador, ${campaignName}`}
	class="max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-[var(--z-sticky)] max-lg:border-t max-lg:border-border max-lg:bg-surface max-lg:pb-[env(safe-area-inset-bottom)] lg:mb-6 lg:border-b lg:border-border"
	data-portal-tabs
>
	<ul class="m-0 grid list-none auto-cols-fr grid-flow-col p-0 lg:flex lg:gap-1">
		{#each items as item (item.section)}
			<li>
				<a
					class="{link} {item.current ? current : idle}"
					href={resolve(`/portal/[campaignId]/${item.section}`, { campaignId })}
					aria-current={item.current ? 'page' : undefined}
				>
					<svg
						class="lg:hidden"
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.75"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"><path d={ICONS[item.section]} /></svg
					>
					<!-- The link's name is the full label at every width; the short word is only drawn. -->
					<span class="max-lg:sr-only">{item.label}</span>
					<span class="lg:hidden" aria-hidden="true">{item.tabLabel}</span>
				</a>
			</li>
		{/each}
	</ul>
</nav>

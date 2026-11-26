<script lang="ts" module>
	export interface Breadcrumb {
		label: string;
		/** Omit on the last crumb (current page). */
		href?: string;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { pageHeaderRoots } from './page-header-context';

	/**
	 * Page heading: one link back to the parent, the page's single `h1`, description and actions.
	 *
	 * `breadcrumbs` still describes the path to the page, but only its last parent is shown, as a
	 * «Volver a …» link: the shell's navigation already says where the page is, and a trail of four
	 * links wraps to two lines on a phone. No link is shown when the parent is one the shell offers
	 * on every page (the campaign's home, the campaign list).
	 */
	let {
		title,
		description,
		breadcrumbs,
		actions
	}: {
		title: string;
		description?: string;
		/** The path to the page, parents first; the last crumb is the page itself (no `href`). */
		breadcrumbs?: Breadcrumb[];
		/** The view's only `primary` button goes here. */
		actions?: Snippet;
	} = $props();

	const roots = pageHeaderRoots();
	const back = $derived.by(() => {
		const parent = (breadcrumbs ?? [])
			.slice(0, -1)
			.filter((crumb) => crumb.href)
			.at(-1);
		return parent && !roots().includes(parent.href!) ? parent : null;
	});
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- hrefs are resolved by the caller -->
<header
	class="mb-6 flex flex-col gap-3 min-[720px]:flex-row min-[720px]:items-start min-[720px]:justify-between"
>
	<div class="min-w-0">
		{#if back}
			<a
				href={back.href}
				data-back-link
				class="-ml-1 mb-1 inline-flex min-h-control-sm items-center gap-1 rounded-sm pr-2 text-body-sm text-primary-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus pointer-coarse:min-h-touch"
			>
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="m15 6-6 6 6 6" />
				</svg>
				Volver a {back.label}</a
			>
		{/if}
		<h1 class="text-heading-1 text-text">{title}</h1>
		{#if description}
			<p class="mt-1 max-w-prose text-body text-muted">{description}</p>
		{/if}
	</div>
	{#if actions}
		<div class="flex flex-wrap items-center gap-2">{@render actions()}</div>
	{/if}
</header>

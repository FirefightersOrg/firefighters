<script lang="ts" module>
	export interface Breadcrumb {
		label: string;
		/** Omit on the last crumb (current page). */
		href?: string;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	/** Page heading: breadcrumbs, the page's single `h1`, description and actions. */
	let {
		title,
		description,
		breadcrumbs,
		actions
	}: {
		title: string;
		description?: string;
		breadcrumbs?: Breadcrumb[];
		/** The view's only `primary` button goes here. */
		actions?: Snippet;
	} = $props();
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- hrefs are resolved by the caller -->
<header
	class="mb-6 flex flex-col gap-3 min-[720px]:flex-row min-[720px]:items-start min-[720px]:justify-between"
>
	<div class="min-w-0">
		{#if breadcrumbs?.length}
			<nav aria-label="Ruta de navegación" class="mb-1">
				<ol class="flex flex-wrap items-center gap-1 text-body-sm text-muted">
					{#each breadcrumbs as crumb, i (i)}
						{@const last = i === breadcrumbs.length - 1}
						<li class="flex items-center gap-1">
							{#if crumb.href && !last}
								<a
									href={crumb.href}
									class="rounded-sm text-primary-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus pointer-coarse:inline-flex pointer-coarse:min-h-touch pointer-coarse:items-center"
									>{crumb.label}</a
								>
							{:else}
								<span aria-current={last ? 'page' : undefined}>{crumb.label}</span>
							{/if}
							{#if !last}<span aria-hidden="true">/</span>{/if}
						</li>
					{/each}
				</ol>
			</nav>
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

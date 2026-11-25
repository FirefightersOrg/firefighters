<script lang="ts" module>
	export interface AppHeaderLink {
		label: string;
		href: string;
		/** Marks the current section (`aria-current="page"`). */
		current?: boolean;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Top bar: product, main navigation and session. Below 720px the links collapse into a
	 * dropdown menu with 44px targets. Not wired into the layout yet.
	 */
	let {
		product,
		homeHref = '/',
		links = [],
		user,
		userActions,
		logoutAction
	}: {
		product: string;
		homeHref?: string;
		links?: AppHeaderLink[];
		user?: string;
		/** Custom session actions. Replaces the default «Cerrar sesión» form. */
		userActions?: Snippet;
		/** Form action URL (POST) for the default «Cerrar sesión» button. */
		logoutAction?: string;
	} = $props();

	let menuOpen = $state(false);
	const menuId = $props.id();

	// Redesign: the current section is marked by a reflective-yellow underline, not a tinted pill.
	const linkClass =
		'inline-flex min-h-touch items-center rounded-md border-b-[3px] border-transparent px-3 text-label text-muted hover:bg-surface-hover hover:text-text aria-[current=page]:border-accent aria-[current=page]:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- hrefs are resolved by the caller -->
<svelte:window onkeydown={(e) => e.key === 'Escape' && (menuOpen = false)} />

{#snippet session()}
	{#if user}<span class="text-body-sm text-muted">{user}</span>{/if}
	{#if userActions}
		{@render userActions()}
	{:else if logoutAction}
		<form method="POST" action={logoutAction}>
			<button
				type="submit"
				class="inline-flex min-h-touch items-center rounded-md px-3 text-label text-text hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus min-[720px]:min-h-control-md"
				>Cerrar sesión</button
			>
		</form>
	{/if}
{/snippet}

<header class="sticky top-0 z-[var(--z-sticky)] border-b border-border bg-surface">
	<div class="mx-auto flex min-h-14 max-w-content items-center gap-4 px-4">
		<a
			href={homeHref}
			class="inline-flex min-h-touch items-center gap-2.5 rounded-sm text-heading-3 text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
		>
			<!-- The institution mark: the only place, with the bond stub, where the brand red appears. -->
			<span class="h-7 w-2.5 rounded-xs bg-brand" aria-hidden="true"></span>{product}</a
		>

		{#if links.length}
			<nav aria-label="Principal" class="hidden min-[720px]:block">
				<ul class="flex items-center gap-1">
					{#each links as link (link.href)}
						<li>
							<a href={link.href} aria-current={link.current ? 'page' : undefined} class={linkClass}
								>{link.label}</a
							>
						</li>
					{/each}
				</ul>
			</nav>
		{/if}

		<div class="ml-auto flex items-center gap-3">
			<!-- Without links there is no mobile menu, so the session stays visible at every width. -->
			<div
				class={links.length
					? 'hidden items-center gap-3 min-[720px]:flex'
					: 'flex items-center gap-3'}
			>
				{@render session()}
			</div>
			{#if links.length}
				<button
					type="button"
					class="inline-flex size-touch items-center justify-center rounded-md text-text hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus min-[720px]:hidden"
					aria-expanded={menuOpen}
					aria-controls={menuId}
					aria-label="Menú"
					onclick={() => (menuOpen = !menuOpen)}
				>
					<svg
						viewBox="0 0 24 24"
						width="20"
						height="20"
						fill="none"
						stroke="currentColor"
						stroke-width="1.75"
						stroke-linecap="round"
						aria-hidden="true"
					>
						<path d="M4 6h16M4 12h16M4 18h16" />
					</svg>
				</button>
			{/if}
		</div>
	</div>

	{#if links.length}
		<div id={menuId} class="border-t border-border px-4 py-2 min-[720px]:hidden" hidden={!menuOpen}>
			<nav aria-label="Principal (móvil)">
				<ul class="flex flex-col">
					{#each links as link (link.href)}
						<li>
							<a
								href={link.href}
								aria-current={link.current ? 'page' : undefined}
								class="{linkClass} w-full"
								onclick={() => (menuOpen = false)}>{link.label}</a
							>
						</li>
					{/each}
				</ul>
			</nav>
			<div class="mt-2 flex items-center justify-between gap-3 border-t border-border pt-2">
				{@render session()}
			</div>
		</div>
	{/if}
</header>

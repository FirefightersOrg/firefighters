<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { Snippet } from 'svelte';
	import { campaignNav, type CampaignNavItem, type CampaignSectionKey } from '$lib/navigation';

	/**
	 * The shell of a campaign (UX plan PR 5): the institution and the campaign in the top bar with the
	 * bond search, the sections as a rail from 1024px and as a bottom tab bar below it, and the page in
	 * between. Sections come from `campaignNav`, by permission; the current one carries the yellow
	 * marker, weight 600 and `aria-current`.
	 */
	let {
		institution,
		campaign,
		fullName,
		permissions,
		pathname,
		openSettlements = null,
		children
	}: {
		institution: string;
		campaign: { id: string; name: string };
		fullName?: string | null;
		permissions: readonly string[];
		pathname: string;
		/** Open settlements in the campaign, shown beside «Rendiciones». Null: not known or not allowed. */
		openSettlements?: number | null;
		children: Snippet;
	} = $props();

	const uid = $props.id();
	const nav = $derived(campaignNav(permissions, campaign.id, pathname));
	const onHome = $derived(nav.current?.key === 'home');
	// The campaign page has its own search as its first thing; everywhere else it is in the top bar.
	const showSearch = $derived(permissions.includes('bond.view') && !onHome);
	const canPortal = $derived(permissions.includes('bond.view_own'));
	const moreCurrent = $derived(nav.more.some((group) => group.items.some((item) => item.current)));

	let moreOpen = $state(false);
	let searchOpen = $state(false);
	let moreButton = $state<HTMLButtonElement>();

	afterNavigate(() => {
		moreOpen = false;
		searchOpen = false;
	});

	const href = (item: CampaignNavItem) => resolve(item.route, { id: campaign.id });
	const homeHref = $derived(resolve('/campaigns/[id]', { id: campaign.id }));
	const bondsHref = $derived(resolve('/campaigns/[id]/bonds', { id: campaign.id }));

	/** Stroke icons (24px grid), one per section that can be a tab. */
	const ICONS: Partial<Record<CampaignSectionKey | 'more', string>> = {
		home: 'M4 11 12 4l8 7v9h-5v-6H9v6H4z',
		bonds: 'M4 7h16v10H4zM9 7v10',
		deliveries: 'M4 12h14M13 6l6 6-6 6',
		sales: 'M6 4h12v16l-3-2-3 2-3-2-3 2z',
		settlements: 'M3 6h18v12H3zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
		collectors: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0',
		buyers: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0',
		draws: 'M4 8h16v4a2 2 0 0 0 0 4v0H4v0a2 2 0 0 0 0-4z',
		reports: 'M5 20V10M12 20V4M19 20v-7',
		more: 'M4 6h16M4 12h16M4 18h16'
	};

	const railLink =
		'flex min-h-control-md items-center gap-2 rounded-r-md border-l-[3px] border-transparent px-3 text-label text-muted hover:bg-surface-hover hover:text-text aria-[current=page]:border-accent aria-[current=page]:bg-surface aria-[current=page]:font-semibold aria-[current=page]:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus pointer-coarse:min-h-touch';
	const tabItem =
		'flex min-h-14 w-full flex-col items-center justify-center gap-0.5 border-0 border-t-[3px] bg-transparent px-1 text-caption focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus';
	// One or the other: two border colours on the same element would leave the result to CSS order.
	const tabCurrent = 'border-accent font-semibold text-text';
	const tabIdle = 'border-transparent text-muted';
	const sheetLink =
		'flex min-h-touch items-center gap-2 rounded-md px-3 text-body text-text hover:bg-surface-hover aria-[current=page]:font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key !== 'Escape') return;
		if (moreOpen) {
			moreOpen = false;
			moreButton?.focus();
		}
		searchOpen = false;
	}}
/>

{#snippet icon(name: CampaignSectionKey | 'more')}
	<svg
		width="20"
		height="20"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.75"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<path d={ICONS[name] ?? ICONS.more} />
	</svg>
{/snippet}

{#snippet openCount()}
	{#if openSettlements}
		<span class="ml-auto rounded-full bg-warning-soft px-2 text-caption text-warning-text"
			>{openSettlements}<span class="sr-only">
				{openSettlements === 1 ? 'abierta' : 'abiertas'}</span
			></span
		>
	{/if}
{/snippet}

{#snippet searchForm(id: string, wide: boolean)}
	<form method="GET" action={bondsHref} role="search" aria-label="Buscar bono" class="flex gap-2">
		<label for={id} class="sr-only">Número de bono</label>
		<input
			{id}
			name="base"
			inputmode="numeric"
			autocomplete="off"
			placeholder="Buscar bono"
			class="min-w-0 rounded-md border border-border-strong bg-surface px-3 font-figure text-[18px] font-bold tracking-wide text-text tabular-nums placeholder:font-sans placeholder:text-label placeholder:font-normal placeholder:tracking-normal {wide
				? 'h-12 flex-1'
				: 'h-control-md w-44'}"
		/>
		<button
			type="submit"
			class="inline-flex shrink-0 items-center justify-center rounded-md border border-border-strong bg-surface text-label text-text hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus {wide
				? 'h-12 px-4'
				: 'size-control-md'}"
			aria-label={wide ? undefined : 'Buscar bono'}
		>
			{#if wide}Buscar bono{:else}
				<svg
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.75"
					stroke-linecap="round"
					aria-hidden="true"
				>
					<path d="m21 21-4.3-4.3M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z" />
				</svg>
			{/if}
		</button>
	</form>
{/snippet}

{#snippet session()}
	<form method="POST" action={resolve('/logout')}>
		<button
			type="submit"
			class="inline-flex min-h-touch items-center rounded-md px-3 text-label text-text hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus lg:min-h-control-md"
			>Cerrar sesión</button
		>
	</form>
{/snippet}

<!-- Off-screen until it takes focus (not `sr-only`: it keeps a full 44px target, which the touch
     sweep measures). The first stop for the keyboard. -->
<a
	href="#contenido"
	class="fixed top-2 left-4 z-[var(--z-toast)] inline-flex min-h-touch -translate-y-[calc(100%+1rem)] items-center rounded-md bg-surface px-4 text-label text-text focus:translate-y-0 focus:shadow-lg"
	>Ir al contenido</a
>

<header class="sticky top-0 z-[var(--z-sticky)] border-b border-border bg-surface">
	<div class="mx-auto flex min-h-14 max-w-[1280px] items-center gap-3 px-4 lg:gap-5 lg:px-6">
		<!-- One link: the institution and the campaign, to the campaign's home. With the bond stub, the
		     only place where the brand red appears. -->
		<a
			href={homeHref}
			class="grid min-h-touch min-w-0 grid-cols-[10px_minmax(0,1fr)] items-center gap-x-2.5 rounded-sm text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus lg:flex lg:gap-3"
		>
			<span class="row-span-2 h-8 w-2.5 rounded-xs bg-brand lg:h-7" aria-hidden="true"></span>
			<span class="truncate text-[15px] leading-[18px] font-semibold lg:text-heading-3"
				>{institution}</span
			>
			<span class="truncate text-body-sm leading-[18px] text-muted lg:ml-1 lg:text-label"
				>{campaign.name}</span
			>
		</a>

		<div class="ml-auto flex items-center gap-3">
			{#if showSearch}
				<div class="hidden lg:block">{@render searchForm(`${uid}-search`, false)}</div>
				<button
					type="button"
					class="inline-flex size-touch items-center justify-center rounded-md text-text hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus lg:hidden"
					aria-label="Buscar un bono"
					aria-expanded={searchOpen}
					aria-controls="{uid}-search-panel"
					onclick={() => (searchOpen = !searchOpen)}
				>
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.75"
						stroke-linecap="round"
						aria-hidden="true"
					>
						<path d="m21 21-4.3-4.3M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z" />
					</svg>
				</button>
			{/if}
			<div class="hidden items-center gap-3 lg:flex">
				{#if fullName}<span class="text-body-sm text-muted">{fullName}</span>{/if}
				{@render session()}
			</div>
		</div>
	</div>
	{#if showSearch}
		<div
			id="{uid}-search-panel"
			class="border-t border-border px-4 py-3 lg:hidden"
			hidden={!searchOpen}
		>
			{@render searchForm(`${uid}-search-phone`, true)}
		</div>
	{/if}
</header>

<div
	class="mx-auto grid max-w-[1280px] gap-10 px-4 pt-6 pb-28 lg:grid-cols-[208px_minmax(0,1fr)] lg:px-6 lg:pt-8 lg:pb-16"
>
	<nav
		aria-label="Secciones de la campaña"
		class="hidden lg:sticky lg:top-[84px] lg:block lg:self-start"
		data-campaign-rail
	>
		{#each nav.groups as group (group.group)}
			{#if group.title}
				<p class="m-0 mt-5 mb-1 px-3 text-body-sm text-subtle" id="{uid}-rail-{group.group}">
					{group.title}
				</p>
			{/if}
			<ul
				class="m-0 list-none p-0"
				aria-labelledby={group.title ? `${uid}-rail-${group.group}` : undefined}
			>
				{#each group.items as item (item.key)}
					<li>
						<a href={href(item)} aria-current={item.current ? 'page' : undefined} class={railLink}
							>{item.label}{#if item.key === 'settlements'}{@render openCount()}{/if}</a
						>
					</li>
				{/each}
			</ul>
		{/each}
		<ul class="m-0 mt-5 list-none border-t border-border p-0 pt-3">
			<li><a href={resolve('/campaigns')} class={railLink}>Cambiar de campaña</a></li>
			{#if canPortal}<li><a href={resolve('/portal')} class={railLink}>Mi portal</a></li>{/if}
		</ul>
	</nav>

	<main id="contenido" tabindex="-1" class="min-w-0 outline-none">
		{@render children()}
	</main>
</div>

{#if moreOpen}
	<button
		type="button"
		class="fixed inset-0 z-[calc(var(--z-sticky)-1)] cursor-default border-0 bg-overlay lg:hidden"
		aria-label="Cerrar el menú"
		tabindex="-1"
		onclick={() => (moreOpen = false)}
	></button>
{/if}

<nav
	aria-label="Secciones de la campaña, barra inferior"
	class="fixed inset-x-0 bottom-0 z-[var(--z-sticky)] border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
	data-campaign-tabs
>
	<ul class="m-0 grid list-none auto-cols-fr grid-flow-col p-0">
		{#each nav.tabs as item (item.key)}
			<li>
				<a
					href={href(item)}
					aria-current={item.current ? 'page' : undefined}
					class="{tabItem} {item.current ? tabCurrent : tabIdle}"
					>{@render icon(item.key)}{item.tabLabel ?? item.label}</a
				>
			</li>
		{/each}
		<!-- Always there: besides the other sections it holds the campaign switch and the session. -->
		<li>
			<button
				bind:this={moreButton}
				type="button"
				class="{tabItem} cursor-pointer {moreCurrent
					? tabCurrent
					: moreOpen
						? 'border-transparent font-semibold text-text'
						: tabIdle}"
				aria-expanded={moreOpen}
				aria-controls="{uid}-more"
				onclick={() => (moreOpen = !moreOpen)}
				>{@render icon('more')}Más{#if moreCurrent}<span class="sr-only">
						, sección actual</span
					>{/if}</button
			>
		</li>
	</ul>
	<div
		id="{uid}-more"
		class="absolute inset-x-0 bottom-full max-h-[70vh] overflow-y-auto rounded-t-lg border-t border-border bg-surface-raised px-2 pt-3 pb-4 shadow-lg"
		hidden={!moreOpen}
		data-campaign-more
	>
		{#each nav.more as group (group.group)}
			{#if group.title}
				<p
					class="m-0 mt-3 mb-1 px-3 text-body-sm text-subtle first:mt-0"
					id="{uid}-more-{group.group}"
				>
					{group.title}
				</p>
			{/if}
			<ul
				class="m-0 list-none p-0"
				aria-labelledby={group.title ? `${uid}-more-${group.group}` : undefined}
			>
				{#each group.items as item (item.key)}
					<li>
						<a href={href(item)} aria-current={item.current ? 'page' : undefined} class={sheetLink}
							>{item.label}{#if item.key === 'settlements'}{@render openCount()}{/if}</a
						>
					</li>
				{/each}
			</ul>
		{/each}
		<ul class="m-0 mt-3 list-none border-t border-border p-0 pt-3">
			<li><a href={resolve('/campaigns')} class={sheetLink}>Cambiar de campaña</a></li>
			{#if canPortal}<li><a href={resolve('/portal')} class={sheetLink}>Mi portal</a></li>{/if}
		</ul>
		<div class="mt-3 flex items-center justify-between gap-3 border-t border-border px-3 pt-3">
			{#if fullName}<span class="min-w-0 truncate text-body-sm text-muted">{fullName}</span>{/if}
			{@render session()}
		</div>
	</div>
</nav>

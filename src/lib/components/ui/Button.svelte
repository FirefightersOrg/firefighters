<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
	import Icon from './Icon.svelte';
	import { cn } from './cn';
	import type { IconName } from './icon-names';

	type Props = Omit<HTMLButtonAttributes, 'children' | 'class'> &
		Pick<HTMLAnchorAttributes, 'target' | 'rel' | 'download'> & {
			variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
			size?: 'sm' | 'md' | 'lg';
			/** Leading icon. Without children it makes an icon-only button (needs `aria-label`). */
			icon?: IconName;
			iconEnd?: IconName;
			loading?: boolean;
			block?: boolean;
			/** Renders an `<a>` instead of a `<button>`. */
			href?: string;
			class?: string;
			children?: Snippet;
		};

	let {
		variant = 'secondary',
		size = 'md',
		icon,
		iconEnd,
		loading = false,
		block = false,
		href,
		type = 'button',
		disabled = false,
		class: className,
		children,
		onclick,
		target,
		rel,
		download,
		...rest
	}: Props = $props();

	const iconOnly = $derived(!!icon && !children);
	const inactive = $derived(disabled || loading);

	const VARIANTS = {
		primary: 'bg-primary text-on-primary hover:bg-primary-hover',
		secondary: 'bg-surface text-text border-border-strong shadow-xs hover:bg-surface-hover',
		ghost: 'bg-transparent text-muted hover:bg-surface-hover hover:text-text',
		danger: 'bg-danger text-on-danger hover:bg-danger-hover'
	} as const;
	const SIZES = {
		sm: 'h-control-sm px-3',
		md: 'h-control-md px-4',
		lg: 'h-control-lg px-6 text-[15px]'
	} as const;
	const ICON_ONLY_SIZES = { sm: 'w-control-sm', md: 'w-control-md', lg: 'w-control-lg' } as const;

	const classes = $derived(
		cn(
			'relative inline-flex items-center justify-center gap-2 border border-transparent rounded-md',
			'text-label whitespace-nowrap no-underline cursor-pointer select-none',
			'transition-colors duration-[120ms] motion-reduce:transition-none',
			// At least 44px to touch on touch screens.
			'pointer-coarse:min-h-touch',
			iconOnly && 'pointer-coarse:min-w-touch',
			SIZES[size],
			iconOnly && ['px-0', ICON_ONLY_SIZES[size]],
			block && 'w-full',
			VARIANTS[variant],
			// Disabled looks flat. Loading keeps its variant colors (aria-busy), only the cursor changes.
			disabled &&
				'bg-surface-sunken! text-disabled! border-transparent! shadow-none! cursor-not-allowed',
			loading && !disabled && 'cursor-progress',
			className
		)
	);

	function handleClick(event: MouseEvent & { currentTarget: EventTarget & HTMLElement }) {
		if (inactive) {
			event.preventDefault();
			return;
		}
		(onclick as ((e: typeof event) => void) | null | undefined)?.(event);
	}
</script>

{#snippet content()}
	{#if loading}
		<svg
			class="absolute size-icon-sm animate-spin motion-reduce:[animation-duration:2s]"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.75"
			stroke-linecap="round"
			aria-hidden="true"
		>
			<path d="M21 12a9 9 0 1 1-6.219-8.56" />
		</svg>
	{/if}
	<!-- The label stays in the layout while loading so the width never changes. -->
	<span class={cn('inline-flex items-center justify-center gap-2', loading && 'invisible')}>
		{#if icon}<Icon name={icon} size="sm" />{/if}
		{@render children?.()}
		{#if iconEnd}<Icon name={iconEnd} size="sm" />{/if}
	</span>
{/snippet}

{#if href}
	<!-- The caller passes an already resolved href (resolve() from $app/paths when needed). -->
	<!-- eslint-disable svelte/no-navigation-without-resolve -->
	<a
		{...rest as HTMLAnchorAttributes}
		href={inactive ? undefined : href}
		{target}
		{rel}
		{download}
		class={classes}
		role={inactive ? 'link' : undefined}
		aria-disabled={inactive ? 'true' : undefined}
		aria-busy={loading ? 'true' : undefined}
		onclick={handleClick}
	>
		{@render content()}
	</a>
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
{:else}
	<button
		{...rest}
		{type}
		class={classes}
		aria-disabled={loading && !disabled ? 'true' : undefined}
		aria-busy={loading ? 'true' : undefined}
		disabled={disabled || undefined}
		onclick={handleClick}
	>
		{@render content()}
	</button>
{/if}

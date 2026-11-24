<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Info from '@lucide/svelte/icons/info';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import X from '@lucide/svelte/icons/x';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import Inbox from '@lucide/svelte/icons/inbox';
	import Download from '@lucide/svelte/icons/download';
	import Menu from '@lucide/svelte/icons/menu';
	import type { Component } from 'svelte';
	import { cn } from './cn';
	import type { IconName } from './icon-names';

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const ICONS: Record<IconName, Component<any>> = {
		check: Check,
		info: Info,
		alert: TriangleAlert,
		error: CircleAlert,
		success: CircleCheck,
		x: X,
		'chevron-down': ChevronDown,
		plus: Plus,
		search: Search,
		inbox: Inbox,
		download: Download,
		menu: Menu
	};

	let {
		name,
		size = 'md',
		label,
		class: className
	}: { name: IconName; size?: 'sm' | 'md'; label?: string; class?: string } = $props();

	const Glyph = $derived(ICONS[name]);
	const px = $derived(size === 'sm' ? 16 : 20);
</script>

<!-- Lucide at the Cimiento stroke (1.75). Decorative unless `label` is given. -->
<Glyph
	size={px}
	strokeWidth={1.75}
	class={cn('shrink-0', className)}
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
/>

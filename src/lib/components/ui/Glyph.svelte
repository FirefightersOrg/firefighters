<script lang="ts">
	import type { GlyphName } from './tones';

	/**
	 * Internal icon set for the feedback components (decorative: always `aria-hidden`).
	 * Private to `ui/`; the shared Icon component of the kit may replace it later.
	 */
	let { name, size = 20 }: { name: GlyphName; size?: number } = $props();

	const PATHS: Record<GlyphName, string> = {
		info: 'M12 8h.01M11 12h1v5h1M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
		success: 'm8 12 3 3 5-6M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
		alert:
			'M12 9v4m0 4h.01M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z',
		error: 'm9 9 6 6m0-6-6 6M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
		x: 'M6 6l12 12M18 6 6 18',
		'chevron-down': 'm6 9 6 6 6-6',
		inbox: 'M3 13h5l1 3h6l1-3h5M3 13l2.5-7h13L21 13v6H3v-6Z',
		search: 'm21 21-4.3-4.3M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z'
	};
</script>

<svg
	class="shrink-0"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	focusable="false"
>
	<path d={PATHS[name]} />
</svg>

<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * The bar of a focused task (loading a settlement, building a delivery): the running figure and
	 * the one action that finishes it. On phones and tablets it is fixed to the bottom of the screen,
	 * within reach of the thumb, and replaces the navigation tabs; from 1024px it is a normal block.
	 * It adds its own space under the page, so the last control is never covered.
	 */
	let {
		label,
		children,
		action
	}: {
		/** Names the region for assistive tech (e.g. «Cierre de la rendición»). */
		label: string;
		/** The figure and its caption. */
		children: Snippet;
		/** The action that finishes the task: one button. */
		action: Snippet;
	} = $props();
</script>

<div class="h-20 min-[1024px]:hidden" aria-hidden="true" data-taskbar-spacer></div>
<div
	role="region"
	aria-label={label}
	data-taskbar
	class="fixed inset-x-0 bottom-0 z-[var(--z-sticky)] flex items-center gap-3 border-t border-border-strong bg-surface px-4 pt-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))] min-[1024px]:static min-[1024px]:z-auto min-[1024px]:rounded-lg min-[1024px]:border min-[1024px]:border-border min-[1024px]:p-4"
>
	<div class="min-w-0 flex-1">{@render children()}</div>
	<div class="shrink-0">{@render action()}</div>
</div>

<script lang="ts">
	/**
	 * The winning number drawn as the stub of a bond (redesign): a brand-red stripe, a dotted cut with
	 * two notches, and the number in Plex Sans Condensed. The only bold visual gesture of the product;
	 * use it for winning numbers only.
	 */
	let {
		number,
		caption,
		detail
	}: {
		/** Already formatted with the campaign's digits (e.g. "0100"). */
		number: string;
		/** Small text above the number (e.g. "Premio 1"). */
		caption: string;
		/** Optional line under the number. */
		detail?: string;
	} = $props();
</script>

<div
	class="relative inline-flex items-stretch rounded-md border border-border-strong bg-surface"
	role="img"
	aria-label="{caption}: número {number}{detail ? `, ${detail}` : ''}"
>
	<span class="w-2.5 rounded-l-md bg-brand" aria-hidden="true"></span>
	<span
		class="stub-cut relative w-4 border-r-2 border-dotted border-border-strong"
		aria-hidden="true"
	></span>
	<span class="px-5 pt-3 pb-2.5" aria-hidden="true">
		<span class="block text-caption text-muted">{caption}</span>
		<span class="block font-figure text-[54px] leading-none font-bold tracking-wide tabular-nums"
			>{number}</span
		>
		{#if detail}<span class="block text-body-sm text-muted">{detail}</span>{/if}
	</span>
</div>

<style>
	/* The two notches of the perforation, cut out of the top and bottom edges. */
	.stub-cut::before,
	.stub-cut::after {
		content: '';
		position: absolute;
		right: -9px;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--surface);
		border: 1px solid var(--border-strong);
	}
	.stub-cut::before {
		top: -9px;
		clip-path: inset(50% 0 0 0);
	}
	.stub-cut::after {
		bottom: -9px;
		clip-path: inset(0 0 50% 0);
	}
</style>

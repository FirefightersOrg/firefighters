<script lang="ts">
	/**
	 * A bond number drawn as the stub of the paper bond (redesign): a brand-red stripe, a dotted cut
	 * with two notches, and the number in Plex Sans Condensed. The only bold visual gesture of the
	 * product: use it where the bond itself is the subject (a winning number, the header of a bond
	 * record), never as decoration in a list.
	 */
	let {
		number,
		caption,
		detail,
		size = 'lg'
	}: {
		/** Already formatted with the campaign's digits (e.g. "0100"). */
		number: string;
		/** Small text above the number (e.g. "Premio 1"). */
		caption: string;
		/** Optional line under the number. */
		detail?: string;
		/** `lg` (default) for the number as the subject of the page; `md` inside a denser header. */
		size?: 'md' | 'lg';
	} = $props();
</script>

<!-- The visible text is the accessible text (caption, then the number as written), so a screen reader
     reads "0100" as on paper instead of an aria-label it might pronounce as "cien". -->
<div
	class="relative inline-flex max-w-full items-stretch rounded-md border border-border-strong bg-surface"
>
	<span class="w-2.5 shrink-0 rounded-l-md bg-brand" aria-hidden="true"></span>
	<span
		class="stub-cut relative w-4 shrink-0 border-r-2 border-dotted border-border-strong"
		aria-hidden="true"
	></span>
	<span class="min-w-0 px-4 pt-3 pb-2.5 sm:px-5">
		<span class="block text-caption text-muted">{caption}</span>
		<span
			class="block font-figure leading-none font-bold tracking-wide break-all tabular-nums {size ===
			'lg'
				? 'text-[40px] sm:text-[54px]'
				: 'text-[32px] sm:text-[40px]'}">{number}</span
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

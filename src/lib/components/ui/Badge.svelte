<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Tone } from './tones';

	/**
	 * Short status or category label: a mark plus a word, never colour alone. The mark's shape follows
	 * the tone (round for neutral, info and success; a diamond for warning; a square for danger), so a
	 * state can be told apart without seeing its colour.
	 */
	let {
		tone = 'neutral',
		dot = true,
		children
	}: { tone?: Tone; dot?: boolean; children: Snippet } = $props();

	const TONE_CLASS: Record<Tone, string> = {
		neutral: 'bg-neutral-soft text-muted',
		info: 'bg-primary-soft text-primary-text',
		success: 'bg-success-soft text-success-text',
		warning: 'bg-warning-soft text-warning-text',
		danger: 'bg-danger-soft text-danger-text'
	};
	const DOT_CLASS: Record<Tone, string> = {
		neutral: 'rounded-full bg-subtle',
		info: 'rounded-full bg-primary',
		success: 'rounded-full bg-success',
		warning: 'rotate-45 bg-warning',
		danger: 'rounded-[1px] bg-danger'
	};
	const SHAPE: Record<Tone, 'round' | 'diamond' | 'square'> = {
		neutral: 'round',
		info: 'round',
		success: 'round',
		warning: 'diamond',
		danger: 'square'
	};
</script>

<span
	class="inline-flex h-6 items-center gap-1.5 rounded-sm px-2 text-caption whitespace-nowrap {TONE_CLASS[
		tone
	]}"
	data-tone={tone}
>
	{#if dot}<span class="size-2 {DOT_CLASS[tone]}" data-shape={SHAPE[tone]} aria-hidden="true"
		></span>{/if}
	{@render children()}
</span>

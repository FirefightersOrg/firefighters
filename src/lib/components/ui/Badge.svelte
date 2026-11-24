<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Tone } from './tones';

	/** Short status or category label: a colored dot plus a word, never color alone. */
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
		neutral: 'bg-subtle',
		info: 'bg-primary',
		success: 'bg-success',
		warning: 'bg-warning',
		danger: 'bg-danger'
	};
</script>

<span
	class="inline-flex h-6 items-center gap-1.5 rounded-sm px-2 text-caption whitespace-nowrap {TONE_CLASS[
		tone
	]}"
	data-tone={tone}
>
	{#if dot}<span class="size-2 rounded-full {DOT_CLASS[tone]}" aria-hidden="true"></span>{/if}
	{@render children()}
</span>

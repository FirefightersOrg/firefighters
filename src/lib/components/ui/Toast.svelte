<script lang="ts">
	import type { Snippet } from 'svelte';
	import Glyph from './Glyph.svelte';
	import { toastTimeout } from './toast';
	import type { GlyphName, MessageTone } from './tones';

	/**
	 * Brief floating confirmation, one at a time. Rendered inside a live region
	 * (`role="status"`, fixed bottom-center) unless `inline`. Without `action` it calls
	 * `onDismiss` after 5 s; with an action it stays until closed.
	 */
	let {
		tone = 'success',
		action,
		onDismiss,
		inline = false,
		children
	}: {
		tone?: MessageTone;
		action?: Snippet;
		onDismiss?: () => void;
		inline?: boolean;
		children: Snippet;
	} = $props();

	const ICONS: Record<MessageTone, GlyphName> = {
		info: 'info',
		success: 'success',
		warning: 'alert',
		danger: 'error'
	};
	const ICON_CLASS: Record<MessageTone, string> = {
		info: 'text-primary',
		success: 'text-success',
		warning: 'text-warning',
		danger: 'text-danger'
	};

	$effect(() => {
		const ms = toastTimeout(action !== undefined);
		if (ms === null || !onDismiss) return;
		const timer = setTimeout(onDismiss, ms);
		return () => clearTimeout(timer);
	});
</script>

{#snippet toast()}
	<div
		class="pointer-events-auto flex w-full max-w-110 items-center gap-3 rounded-md border border-border bg-surface-raised py-3 pr-3 pl-4 text-body text-text shadow-lg"
		data-tone={tone}
	>
		<span class={ICON_CLASS[tone]}><Glyph name={ICONS[tone]} /></span>
		<span class="flex-1">{@render children()}</span>
		{#if action}{@render action()}{/if}
		{#if onDismiss}
			<button
				type="button"
				class="grid size-touch shrink-0 cursor-pointer place-items-center rounded-md text-muted hover:bg-surface-hover"
				aria-label="Cerrar aviso"
				onclick={onDismiss}
			>
				<Glyph name="x" />
			</button>
		{/if}
	</div>
{/snippet}

{#if inline}
	<div role="status" aria-live="polite">{@render toast()}</div>
{:else}
	<div
		class="pointer-events-none fixed inset-x-4 bottom-4 z-60 flex flex-col items-center gap-2"
		role="status"
		aria-live="polite"
	>
		{@render toast()}
	</div>
{/if}

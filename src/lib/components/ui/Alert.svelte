<script lang="ts">
	import type { Snippet } from 'svelte';
	import Glyph from './Glyph.svelte';
	import type { GlyphName, MessageTone } from './tones';

	/**
	 * In-page message. `danger` is announced immediately (`role="alert"`); the other tones use
	 * `role="status"`. `onDismiss` shows the close button (not for blocking errors).
	 */
	let {
		tone = 'info',
		title,
		actions,
		onDismiss,
		children
	}: {
		tone?: MessageTone;
		title?: string;
		actions?: Snippet;
		onDismiss?: () => void;
		children?: Snippet;
	} = $props();

	const ICONS: Record<MessageTone, GlyphName> = {
		info: 'info',
		success: 'success',
		warning: 'alert',
		danger: 'error'
	};
	const TONE_CLASS: Record<MessageTone, string> = {
		info: 'bg-primary-soft border-primary text-primary',
		success: 'bg-success-soft border-success text-success',
		warning: 'bg-warning-soft border-warning text-warning',
		danger: 'bg-danger-soft border-danger text-danger'
	};
</script>

<div
	class="flex gap-3 rounded-md border px-4 py-3 text-body {TONE_CLASS[tone]}"
	role={tone === 'danger' ? 'alert' : 'status'}
	data-tone={tone}
>
	<span class="mt-0.5"><Glyph name={ICONS[tone]} /></span>
	<div class="min-w-0 flex-1 text-text">
		{#if title}<p class="m-0 font-semibold">{title}</p>{/if}
		{#if children}<div class="m-0">{@render children()}</div>{/if}
		{#if actions}<div class="mt-3 flex gap-2">{@render actions()}</div>{/if}
	</div>
	{#if onDismiss}
		<button
			type="button"
			class="-my-1.5 -mr-2 grid size-touch shrink-0 cursor-pointer place-items-center rounded-md text-muted hover:bg-surface-hover"
			aria-label="Cerrar aviso"
			onclick={onDismiss}
		>
			<Glyph name="x" />
		</button>
	{/if}
</div>

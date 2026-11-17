<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		kind = 'error',
		message,
		children
	}: {
		kind?: 'error' | 'success' | 'warning';
		message?: string;
		children?: Snippet;
	} = $props();

	const TONES = {
		error: 'bg-red-50 border-red-200 text-red-800',
		success: 'bg-green-50 border-green-200 text-green-800',
		warning: 'bg-amber-50 border-amber-200 text-amber-900'
	} as const;
</script>

<div
	role={kind === 'error' ? 'alert' : 'status'}
	class="rounded-lg border p-3 text-sm {TONES[kind]}"
>
	{#if message}<p>{message}</p>{/if}
	{@render children?.()}
</div>

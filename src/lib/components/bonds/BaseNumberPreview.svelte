<script lang="ts">
	import type { BaseNumberPreview } from '$lib/domain/bond-preview';

	/**
	 * Live preview of the typed base number (computed by `previewBaseNumber`): the base number
	 * padded like the campaign shows it and its associated number, or why it cannot be used
	 * (format, range, overflow). Announced politely to screen readers.
	 */
	let {
		id = 'baseNumber-preview',
		preview
	}: {
		id?: string;
		preview: BaseNumberPreview;
	} = $props();
</script>

<div
	{id}
	aria-live="polite"
	class="rounded-lg border p-4 text-sm {preview.state === 'invalid'
		? 'border-red-200 bg-red-50 text-red-800'
		: 'border-slate-200 bg-slate-50 text-slate-700'}"
>
	<h3 class="text-xs font-semibold uppercase tracking-wider text-slate-500">
		Numbers of this bond
	</h3>
	{#if preview.state === 'empty'}
		<p class="mt-2 text-slate-500">Type the base number to see its associated number.</p>
	{:else if preview.state === 'invalid'}
		<p class="mt-2 font-medium">{preview.message}.</p>
	{:else}
		<dl class="mt-2 flex flex-wrap items-baseline gap-x-8 gap-y-2">
			<div>
				<dt class="text-xs text-slate-500">Base number</dt>
				<dd class="font-mono text-2xl font-semibold tabular-nums text-slate-900">
					{preview.baseFormatted}
				</dd>
			</div>
			<div aria-hidden="true" class="text-xl text-slate-400">→</div>
			<div>
				<dt class="text-xs text-slate-500">Associated number</dt>
				<dd class="font-mono text-2xl font-semibold tabular-nums text-slate-900">
					{preview.associatedFormatted}
				</dd>
			</div>
		</dl>
	{/if}
</div>

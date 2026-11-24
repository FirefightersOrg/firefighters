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
	class="rounded-lg border p-4 text-body-sm {preview.state === 'invalid'
		? 'border-danger bg-danger-soft text-danger-text'
		: 'border-border bg-surface-sunken text-text'}"
>
	<h3 class="m-0 text-label text-muted">Números de este bono</h3>
	{#if preview.state === 'empty'}
		<p class="m-0 mt-2 text-muted">Ingresar el número base para ver su número asociado.</p>
	{:else if preview.state === 'invalid'}
		<p class="m-0 mt-2 font-medium">{preview.message}.</p>
	{:else}
		<dl class="m-0 mt-2 flex flex-wrap items-baseline gap-x-8 gap-y-2">
			<div>
				<dt class="text-caption text-muted">Número base</dt>
				<dd class="m-0 font-mono text-number-lg tabular-nums">{preview.baseFormatted}</dd>
			</div>
			<div aria-hidden="true" class="text-heading-2 text-subtle">→</div>
			<div>
				<dt class="text-caption text-muted">Número asociado</dt>
				<dd class="m-0 font-mono text-number-lg tabular-nums">{preview.associatedFormatted}</dd>
			</div>
		</dl>
	{/if}
</div>

<script lang="ts">
	import { formatNumber } from '$lib/format';
	import type { CampaignNumberingInputPreview } from '$lib/schemas/campaign';

	/**
	 * Live numbering preview (computed by `previewNumberingInput`): example base → associated
	 * numbers, the highest usable base number, how many base numbers are usable, the first base
	 * that would overflow, or the configuration problems. Announced politely to screen readers.
	 */
	let {
		id = 'numbering-preview',
		preview
	}: {
		id?: string;
		preview: CampaignNumberingInputPreview;
	} = $props();
</script>

<div
	{id}
	aria-live="polite"
	class="rounded-md border border-border bg-surface-sunken p-4 text-body-sm text-text"
>
	<h3 class="m-0 text-label text-muted">Vista previa de la numeración</h3>

	{#if preview.state === 'incomplete'}
		<p class="m-0 mt-2 text-muted">
			Completar la cantidad de dígitos, el número máximo y el desfase para ver ejemplos.
		</p>
	{:else if preview.state === 'invalid'}
		<p class="m-0 mt-2 text-label text-danger-text">
			Esta configuración de numeración no es válida:
		</p>
		<ul class="m-0 mt-1 list-disc space-y-0.5 pl-5 text-danger-text">
			{#each preview.issues as issue (issue.field)}
				<li id="{issue.field}-preview-error">{issue.message}</li>
			{/each}
		</ul>
	{:else}
		{@const p = preview.preview}
		<table class="mt-2 text-left">
			<caption class="sr-only">Ejemplos de números base y sus números asociados</caption>
			<thead class="text-caption text-muted">
				<tr>
					<th scope="col" class="pr-6 font-medium">Número base</th>
					<th scope="col" class="font-medium">Número asociado</th>
				</tr>
			</thead>
			<tbody class="font-mono tabular-nums">
				{#each p.examples as example (example.base)}
					<tr>
						<td class="pr-6">{example.baseFormatted}</td>
						<td>→ {example.associatedFormatted}</td>
					</tr>
				{/each}
			</tbody>
		</table>
		{#if p.mode === 'circular' && p.blockSize !== null && p.associatedRange}
			<p class="m-0 mt-3">
				Modo circular, <strong class="tabular-nums">{formatNumber(p.blockSize)}</strong> bonos:
				números base
				<strong class="font-mono tabular-nums"
					>{p.examples[0].baseFormatted}–{p.maxValidBase.baseFormatted}</strong
				>
				y números asociados
				<strong class="font-mono tabular-nums"
					>{p.associatedRange.from}–{p.associatedRange.to}</strong
				>. Cada número del rango se usa una sola vez.
			</p>
		{:else}
			<p class="m-0 mt-3">
				Mayor número base utilizable:
				<strong class="font-mono tabular-nums">{p.maxValidBase.baseFormatted}</strong>
				(asociado {p.maxValidBase.associatedFormatted}).
				<strong class="tabular-nums">{formatNumber(p.usableBaseCount)}</strong>
				{p.usableBaseCount === 1 ? 'número base utilizable' : 'números base utilizables'}
				({p.examples[0].baseFormatted}–{p.maxValidBase.baseFormatted}).
			</p>
			{#if p.overflowExample}
				<p class="m-0 mt-1 text-warning-text">
					Desborde: el número base
					<span class="font-mono tabular-nums">{p.overflowExample.baseFormatted}</span>
					daría el número asociado
					<span class="font-mono tabular-nums">{p.overflowExample.associated}</span>, por encima del
					máximo <span class="font-mono tabular-nums">{p.overflowExample.maxNumber}</span>, por lo
					que se rechaza.
				</p>
			{:else}
				<p class="m-0 mt-1 text-muted">Ningún número base desborda (el desfase es 0).</p>
			{/if}
		{/if}
	{/if}
</div>

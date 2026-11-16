<script lang="ts">
	import { formatInteger } from '$lib/domain/money';
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
	class="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700"
>
	<h3 class="text-xs font-semibold uppercase tracking-wider text-slate-500">Numbering preview</h3>

	{#if preview.state === 'incomplete'}
		<p class="mt-2 text-slate-500">
			Enter the number of digits, the maximum number and the offset to see examples.
		</p>
	{:else if preview.state === 'invalid'}
		<p class="mt-2 font-medium text-red-700">This numbering configuration is not valid:</p>
		<ul class="mt-1 list-disc space-y-0.5 pl-5 text-red-700">
			{#each preview.issues as issue (issue.field)}
				<li id="{issue.field}-preview-error">{issue.message}</li>
			{/each}
		</ul>
	{:else}
		{@const p = preview.preview}
		<table class="mt-2 text-left">
			<caption class="sr-only">Example base numbers and their associated numbers</caption>
			<thead class="text-xs text-slate-500">
				<tr>
					<th scope="col" class="pr-6 font-medium">Base number</th>
					<th scope="col" class="font-medium">Associated number</th>
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
		<p class="mt-3">
			Highest usable base number: <strong class="font-mono tabular-nums"
				>{p.maxValidBase.baseFormatted}</strong
			>
			(associated {p.maxValidBase.associatedFormatted}).
			<strong class="tabular-nums">{formatInteger(p.usableBaseCount)}</strong>
			usable base {p.usableBaseCount === 1 ? 'number' : 'numbers'}
			({p.examples[0].baseFormatted}–{p.maxValidBase.baseFormatted}).
		</p>
		{#if p.overflowExample}
			<p class="mt-1 text-amber-800">
				Overflow: base <span class="font-mono tabular-nums">{p.overflowExample.baseFormatted}</span>
				would give associated number
				<span class="font-mono tabular-nums">{p.overflowExample.associated}</span>, above the
				maximum <span class="font-mono tabular-nums">{p.overflowExample.maxNumber}</span>, so it is
				rejected.
			</p>
		{:else}
			<p class="mt-1 text-slate-500">No base number overflows (the offset is 0).</p>
		{/if}
	{/if}
</div>

<script lang="ts">
	import { formatInteger } from '$lib/domain/money';
	import type { ImportSessionSummary } from '$lib/server/services/imports';

	/** The seven preview metrics of docs/imports.md, with blocking errors highlighted. */
	let { summary }: { summary: ImportSessionSummary } = $props();

	const metrics = $derived([
		{ label: 'Simple bonds', value: summary.simpleItems, tone: 'neutral' },
		{ label: 'Patas', value: summary.pataGroups, tone: 'neutral' },
		{ label: 'Base numbers', value: summary.baseNumbers, tone: 'neutral' },
		{ label: 'Participating numbers', value: summary.participatingNumbers, tone: 'neutral' },
		{ label: 'Blocking errors', value: summary.errors, tone: summary.errors > 0 ? 'error' : 'ok' },
		{ label: 'Warnings', value: summary.warnings, tone: summary.warnings > 0 ? 'warning' : 'ok' },
		{
			label: 'Duplicates',
			value: summary.duplicates,
			tone: summary.duplicates > 0 ? 'error' : 'ok'
		}
	] as const);

	const TONES = {
		neutral: 'border-slate-200 bg-white text-slate-900',
		ok: 'border-slate-200 bg-white text-slate-900',
		warning: 'border-amber-200 bg-amber-50 text-amber-900',
		error: 'border-red-200 bg-red-50 text-red-800'
	} as const;
</script>

<dl class="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7" aria-label="Import summary">
	{#each metrics as metric (metric.label)}
		<div class="rounded-lg border p-3 {TONES[metric.tone]}">
			<dt class="text-xs font-medium opacity-80">{metric.label}</dt>
			<dd class="mt-1 text-xl font-semibold tabular-nums">{formatInteger(metric.value)}</dd>
		</div>
	{/each}
</dl>
{#if summary.pending > 0 || summary.removedItems > 0}
	<p class="mt-2 text-xs text-slate-500">
		{#if summary.pending > 0}{formatInteger(summary.pending)} rows pending validation.{/if}
		{#if summary.removedItems > 0}{formatInteger(summary.removedItems)} rows removed (kept as history).{/if}
	</p>
{/if}

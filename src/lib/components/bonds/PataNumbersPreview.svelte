<script lang="ts" module>
	/** One base number of the pata: its pair, or why it cannot be used. */
	export interface PataPreviewRow {
		key: string;
		baseFormatted: string | null;
		associatedFormatted: string | null;
		/** Shown instead of the pair (invalid number, unavailable bond...). */
		problem?: string | null;
	}
</script>

<script lang="ts">
	import { formatInteger, formatMoney } from '$lib/domain/money';

	/**
	 * Preview of a pata (printed or manually grouped): every base → associated pair (2N numbers),
	 * what blocks saving, N (`commercial_unit_count`) and the total value (`simple_bond_value * N`,
	 * es-AR). Announced politely to screen readers.
	 */
	let {
		id = 'pata-preview',
		rows,
		problems = [],
		unitCount,
		totalValue,
		simpleBondValue,
		emptyText
	}: {
		id?: string;
		rows: PataPreviewRow[];
		/** Problems that block saving (shown as a list). */
		problems?: string[];
		unitCount: number;
		/** Two-decimal string, null when unknown. */
		totalValue: string | null;
		simpleBondValue: string;
		emptyText: string;
	} = $props();

	const numberCount = $derived(rows.filter((row) => row.baseFormatted && !row.problem).length * 2);
</script>

<div
	{id}
	aria-live="polite"
	class="rounded-lg border p-4 text-sm {problems.length > 0 && rows.length > 0
		? 'border-red-200 bg-red-50'
		: 'border-slate-200 bg-slate-50'} text-slate-700"
>
	<h3 class="text-xs font-semibold uppercase tracking-wider text-slate-500">
		Numbers of this pata
	</h3>
	{#if rows.length === 0}
		<p class="mt-2 text-slate-500">{emptyText}</p>
	{:else}
		<ul
			class="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2"
			aria-label="Base and associated numbers"
		>
			{#each rows as row (row.key)}
				<li class="font-mono tabular-nums">
					{#if row.problem}
						<span class="text-red-800"
							>{row.baseFormatted ?? ''}<span class="font-sans"
								>{row.baseFormatted ? ': ' : ''}{row.problem}</span
							></span
						>
					{:else}
						<span class="font-semibold text-slate-900">{row.baseFormatted}</span>
						<span aria-hidden="true" class="text-slate-400">→</span><span class="sr-only"
							>associated</span
						>
						<span class="font-semibold text-slate-900">{row.associatedFormatted}</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if rows.length > 0 && problems.length > 0}
		<ul class="mt-3 list-disc space-y-1 pl-5 font-medium text-red-800">
			{#each problems as problem, i (i)}
				<li>{problem}.</li>
			{/each}
		</ul>
	{/if}

	<dl class="mt-4 flex flex-wrap gap-x-8 gap-y-2 border-t border-slate-200 pt-3">
		<div>
			<dt class="text-xs text-slate-500">Units (N)</dt>
			<dd class="text-lg font-semibold tabular-nums text-slate-900">{formatInteger(unitCount)}</dd>
		</div>
		<div>
			<dt class="text-xs text-slate-500">Participating numbers</dt>
			<dd class="text-lg font-semibold tabular-nums text-slate-900">
				{formatInteger(numberCount)}
			</dd>
		</div>
		<div>
			<dt class="text-xs text-slate-500">Total value</dt>
			<dd class="text-lg font-semibold tabular-nums text-slate-900">
				{totalValue ? formatMoney(totalValue) : '—'}
			</dd>
			<dd class="text-xs text-slate-500">
				{formatMoney(simpleBondValue)} × {formatInteger(unitCount)}
			</dd>
		</div>
	</dl>
</div>

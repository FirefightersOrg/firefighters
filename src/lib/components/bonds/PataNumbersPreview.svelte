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
	import { formatMoney, formatNumber } from '$lib/format';

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
	class="rounded-lg border p-4 text-body-sm text-text {problems.length > 0 && rows.length > 0
		? 'border-danger bg-danger-soft'
		: 'border-border bg-surface-sunken'}"
>
	<h3 class="m-0 text-label text-muted">Números de esta pata</h3>
	{#if rows.length === 0}
		<p class="m-0 mt-2 text-muted">{emptyText}</p>
	{:else}
		<ul
			class="m-0 mt-2 grid list-none grid-cols-1 gap-x-6 gap-y-1 p-0 sm:grid-cols-2"
			aria-label="Números base y asociados"
		>
			{#each rows as row (row.key)}
				<li class="font-mono tabular-nums">
					{#if row.problem}
						<span class="text-danger-text"
							>{row.baseFormatted ?? ''}<span class="font-sans"
								>{row.baseFormatted ? ': ' : ''}{row.problem}</span
							></span
						>
					{:else}
						<span class="font-semibold">{row.baseFormatted}</span>
						<span aria-hidden="true" class="text-subtle">→</span><span class="sr-only"
							>asociado</span
						>
						<span class="font-semibold">{row.associatedFormatted}</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if rows.length > 0 && problems.length > 0}
		<ul class="m-0 mt-3 list-disc space-y-1 pl-5 font-medium text-danger-text">
			{#each problems as problem, i (i)}
				<li>{problem}.</li>
			{/each}
		</ul>
	{/if}

	<dl class="m-0 mt-4 flex flex-wrap gap-x-8 gap-y-2 border-t border-border pt-3">
		<div>
			<dt class="text-caption text-muted">Unidades (N)</dt>
			<dd class="m-0 text-heading-3 tabular-nums">{formatNumber(unitCount)}</dd>
		</div>
		<div>
			<dt class="text-caption text-muted">Números participantes</dt>
			<dd class="m-0 text-heading-3 tabular-nums">{formatNumber(numberCount)}</dd>
		</div>
		<div>
			<dt class="text-caption text-muted">Valor total</dt>
			<dd class="m-0 text-heading-3 tabular-nums">
				{totalValue ? formatMoney(totalValue) : '—'}
			</dd>
			<dd class="m-0 text-caption text-muted tabular-nums">
				{formatMoney(simpleBondValue)} × {formatNumber(unitCount)}
			</dd>
		</div>
	</dl>
</div>

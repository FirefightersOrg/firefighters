<script lang="ts" module>
	import type { MoneyContext } from './Money.svelte';

	export interface MoneySheetRow {
		label: string;
		value: number | string | null | undefined;
		/**
		 * `line` (default): an amount that adds up. `subtotal`: a rule above it. `deduction`: an amount
		 * taken away, muted and read as «menos». `lead`: the figure the sheet is for, under a double
		 * rule; use exactly one.
		 */
		kind?: 'line' | 'subtotal' | 'deduction' | 'lead';
	}
</script>

<script lang="ts">
	import Money from './Money.svelte';

	/**
	 * Amounts that add up, read top to bottom like a cash sheet: lines, a rule above each subtotal and
	 * a double rule above the lead figure. First used on the closed settlement; wherever money is
	 * summed it should look like this, on screen and on paper.
	 */
	let {
		rows,
		secondary = [],
		context = 'screen'
	}: {
		rows: MoneySheetRow[];
		/** Reference amounts under the sheet (smaller, muted): they do not add up into the lead. */
		secondary?: { label: string; value: number | string | null | undefined }[];
		context?: MoneyContext;
	} = $props();

	const ROW_CLASS = {
		line: 'flex justify-between gap-3 py-2.5',
		subtotal: 'flex justify-between gap-3 border-t border-border-strong py-2.5 font-semibold',
		deduction: 'flex justify-between gap-3 py-2.5 text-muted',
		lead: 'mt-1 flex items-baseline justify-between gap-3 border-t-[3px] border-double border-text pt-3.5'
	};
	/** A deduction is always shown as taken away, whatever the sign of the value it receives. */
	const magnitude = (value: MoneySheetRow['value']) =>
		typeof value === 'number'
			? Math.abs(value)
			: typeof value === 'string'
				? value.trim().replace(/^-/, '')
				: value;
</script>

<dl class="m-0 tabular-nums">
	{#each rows as row (row.label)}
		{@const kind = row.kind ?? 'line'}
		<div class={ROW_CLASS[kind]} data-kind={kind}>
			<dt class={kind === 'lead' ? 'text-body font-semibold' : undefined}>{row.label}</dt>
			<dd
				class="m-0 whitespace-nowrap {kind === 'line' ? 'font-medium' : ''} {kind === 'lead'
					? 'font-figure text-figure-lg'
					: ''}"
			>
				{#if kind === 'deduction'}<span aria-hidden="true">−</span><span class="sr-only">menos</span
					>&nbsp;<Money value={magnitude(row.value)} {context} />{:else}<Money
						value={row.value}
						{context}
					/>{/if}
			</dd>
		</div>
	{/each}
</dl>
{#if secondary.length}
	<dl class="m-0 mt-3 grid gap-1 text-body-sm text-muted tabular-nums">
		{#each secondary as row (row.label)}
			<div class="flex justify-between gap-3">
				<dt>{row.label}</dt>
				<dd class="m-0 whitespace-nowrap"><Money value={row.value} {context} /></dd>
			</div>
		{/each}
	</dl>
{/if}

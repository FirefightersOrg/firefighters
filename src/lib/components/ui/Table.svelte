<script lang="ts" module>
	export interface TableColumn<Row> {
		key: string;
		header: string;
		align?: 'left' | 'right' | 'center';
		/** Monospaced cell (codes, barcodes, ids). */
		mono?: boolean;
		width?: string;
		/** Plain-text cell value; defaults to `row[key]`. For rich cells use the `cell` snippet. */
		render?(row: Row): string | number | null | undefined;
	}
</script>

<script lang="ts" generics="Row extends Record<string, unknown>">
	import type { Snippet } from 'svelte';

	/**
	 * Cimiento data table: sticky header on `surface-sunken`, right-aligned tabular numbers,
	 * mono code columns, selectable rows. It scrolls horizontally inside its own container
	 * (never the page). No data fetching: rows come from the caller.
	 */
	let {
		columns,
		rows,
		rowKey = 'id',
		caption,
		density = 'comfortable',
		selectedKey,
		onRowClick,
		maxHeight,
		empty,
		cell
	}: {
		columns: TableColumn<Row>[];
		rows: Row[];
		/** Property that identifies a row (and is compared with `selectedKey`). */
		rowKey?: string;
		/** Visible caption; also the table's accessible name. */
		caption?: string;
		density?: 'comfortable' | 'compact';
		selectedKey?: string | number;
		/**
		 * Row action. The first cell is wrapped in a real button so it is reachable with the
		 * keyboard (Enter/Space bubble to the row); keep that cell free of other interactive content.
		 */
		onRowClick?: (row: Row) => void;
		/** Any CSS length: enables vertical scrolling with the sticky header. */
		maxHeight?: string;
		/** Content for an empty table, typically an `EmptyState`. */
		empty?: Snippet;
		/** Rich cell content (Badge, actions). Falls back to `render`/`row[key]` when absent. */
		cell?: Snippet<[{ row: Row; column: TableColumn<Row> }]>;
	} = $props();

	const alignClass = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

	function keyOf(row: Row): string | number {
		return row[rowKey] as string | number;
	}
	function textOf(row: Row, column: TableColumn<Row>): string {
		const value = column.render ? column.render(row) : row[column.key];
		return value === null || value === undefined ? '' : String(value);
	}
	const padding = $derived(density === 'compact' ? 'px-3 py-1.5' : 'px-4 py-3');
</script>

{#snippet content(row: Row, column: TableColumn<Row>)}
	{#if cell}
		{@render cell({ row, column })}
	{:else}
		{textOf(row, column)}
	{/if}
{/snippet}

<div
	class="overflow-x-auto rounded-lg border border-border bg-surface"
	class:overflow-y-auto={!!maxHeight}
	style:max-height={maxHeight}
	data-density={density}
>
	<table class="w-full border-collapse text-body-sm">
		{#if caption}
			<caption class="px-4 py-3 text-left text-label text-text">{caption}</caption>
		{/if}
		<thead>
			<tr>
				{#each columns as column (column.key)}
					<th
						scope="col"
						class="sticky top-0 z-[var(--z-sticky)] whitespace-nowrap border-b border-border bg-surface-sunken text-label text-muted {padding} {alignClass[
							column.align ?? 'left'
						]}"
						style:width={column.width}
					>
						{column.header}
					</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each rows as row (keyOf(row))}
				{@const selected = selectedKey !== undefined && keyOf(row) === selectedKey}
				<tr
					class="border-b border-border last:border-b-0 hover:bg-surface-hover"
					class:bg-primary-soft={selected}
					class:cursor-pointer={!!onRowClick}
					data-selected={selected ? 'true' : undefined}
					onclick={onRowClick ? () => onRowClick(row) : undefined}
				>
					{#each columns as column, i (column.key)}
						<td
							class="{padding} {alignClass[column.align ?? 'left']}"
							class:font-mono={column.mono}
							class:tabular-nums={column.align === 'right'}
						>
							{#if onRowClick && i === 0}
								<button
									type="button"
									class="m-0 w-full cursor-pointer rounded-sm border-0 bg-transparent p-0 text-inherit [font:inherit] [text-align:inherit] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
								>
									{@render content(row, column)}
								</button>
							{:else}
								{@render content(row, column)}
							{/if}
						</td>
					{/each}
				</tr>
			{:else}
				<tr>
					<td colspan={columns.length} class="px-4 py-8 text-center text-muted">
						{#if empty}
							{@render empty()}
						{:else}
							Sin resultados.
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

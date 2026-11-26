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
		/**
		 * Where the cell goes when the table is stacked on a phone (`stack`): `primary` opens the row
		 * (the identifier and main fact), `trailing` sits at the end of that first line (an amount or a
		 * status), `secondary` is the muted second line, `hidden` is left out. Columns without a role
		 * follow as lines labelled with their header.
		 */
		stack?: 'primary' | 'trailing' | 'secondary' | 'hidden';
	}
</script>

<script lang="ts" generics="Row extends Record<string, unknown>">
	import type { Snippet } from 'svelte';

	/**
	 * Cimiento data table: sticky header on `surface-sunken`, right-aligned tabular numbers,
	 * mono code columns, selectable rows. It scrolls horizontally inside its own container
	 * (never the page). No data fetching: rows come from the caller.
	 *
	 * With `stack`, below 720px each row becomes a block of two or more lines instead of a strip of
	 * columns that has to be scrolled sideways (see `TableColumn.stack`). The table keeps its rows,
	 * cells and headers for assistive tech: the roles are set explicitly, because changing `display`
	 * on table elements would otherwise drop them.
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
		stack = false,
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
		/** Below 720px, show each row as stacked lines instead of scrolling columns. */
		stack?: boolean;
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

	/** Literal class strings (Tailwind has to see them whole). */
	const STACK_CELL = {
		primary:
			'max-[719px]:col-start-1 max-[719px]:row-start-1 max-[719px]:text-left max-[719px]:text-body max-[719px]:font-medium',
		trailing: 'max-[719px]:col-start-2 max-[719px]:row-start-1 max-[719px]:text-right',
		secondary: 'max-[719px]:col-span-2 max-[719px]:text-left max-[719px]:text-muted',
		hidden: 'max-[719px]:hidden',
		labelled:
			"max-[719px]:col-span-2 max-[719px]:text-left max-[719px]:before:text-muted max-[719px]:before:content-[attr(data-label)':_']"
	} as const;
	const stackCell = (column: TableColumn<Row>) =>
		stack ? `max-[719px]:block max-[719px]:p-0 ${STACK_CELL[column.stack ?? 'labelled']}` : '';
</script>

{#snippet content(row: Row, column: TableColumn<Row>)}
	{#if cell}
		{@render cell({ row, column })}
	{:else}
		{textOf(row, column)}
	{/if}
{/snippet}

<!-- `relative`: the container has to hold its absolutely positioned descendants (an `sr-only` label
     inside a cell). Without it they escape the horizontal scroll and widen the whole page. -->
<div
	class="relative overflow-x-auto rounded-lg border border-border bg-surface"
	class:overflow-y-auto={!!maxHeight}
	style:max-height={maxHeight}
	data-density={density}
>
	<table
		class="w-full border-collapse text-body-sm {stack ? 'max-[719px]:block' : ''}"
		role={stack ? 'table' : undefined}
		data-stack={stack ? 'true' : undefined}
	>
		{#if caption}
			<caption class="px-4 py-3 text-left text-label text-text {stack ? 'max-[719px]:block' : ''}"
				>{caption}</caption
			>
		{/if}
		<thead class={stack ? 'max-[719px]:sr-only' : undefined} role={stack ? 'rowgroup' : undefined}>
			<tr role={stack ? 'row' : undefined}>
				{#each columns as column (column.key)}
					<th
						role={stack ? 'columnheader' : undefined}
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
		<tbody class={stack ? 'max-[719px]:block' : undefined} role={stack ? 'rowgroup' : undefined}>
			{#each rows as row (keyOf(row))}
				{@const selected = selectedKey !== undefined && keyOf(row) === selectedKey}
				<tr
					role={stack ? 'row' : undefined}
					class="border-b border-border last:border-b-0 hover:bg-surface-hover {stack
						? 'max-[719px]:grid max-[719px]:grid-cols-[minmax(0,1fr)_auto] max-[719px]:gap-x-3 max-[719px]:gap-y-0.5 max-[719px]:px-4 max-[719px]:py-3'
						: ''}"
					class:bg-primary-soft={selected}
					class:cursor-pointer={!!onRowClick}
					data-selected={selected ? 'true' : undefined}
					onclick={onRowClick ? () => onRowClick(row) : undefined}
				>
					{#each columns as column, i (column.key)}
						<td
							role={stack ? 'cell' : undefined}
							data-label={stack && !column.stack ? column.header : undefined}
							class="{padding} {alignClass[column.align ?? 'left']} {stackCell(column)}"
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
				<tr role={stack ? 'row' : undefined} class={stack ? 'max-[719px]:block' : undefined}>
					<td
						role={stack ? 'cell' : undefined}
						colspan={columns.length}
						class="px-4 py-8 text-center text-muted {stack ? 'max-[719px]:block' : ''}"
					>
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

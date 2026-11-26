<script lang="ts" module>
	export interface AppliedFilter {
		/** What is applied, as the person chose it («Estado: Vendido»). */
		label: string;
		/** The same list without this filter. Resolved by the caller. */
		removeHref: string;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLInputAttributes } from 'svelte/elements';
	import Button from './Button.svelte';
	import Field from './Field.svelte';
	import Glyph from './Glyph.svelte';
	import TextInput from './TextInput.svelte';

	/**
	 * The top of a list: one search field first (optional), the other filters folded under «Filtrar», and what is
	 * applied shown as chips that can be removed. A plain GET form, so it works without JavaScript and
	 * every state has its own URL. On a phone the first row of the list stays in the first screenful.
	 */
	let {
		action,
		searchName,
		searchLabel,
		searchValue = '',
		searchError,
		inputmode,
		applied = [],
		clearHref,
		open = false,
		filters
	}: {
		/** URL of the list (GET). Resolved by the caller. */
		action: string;
		/** Name of the search field in the query string. Omit (with `searchLabel`) for a list with no search. */
		searchName?: string;
		searchLabel?: string;
		searchValue?: string;
		searchError?: string | null;
		inputmode?: HTMLInputAttributes['inputmode'];
		/** Filters in effect, shown as chips. Their count is shown on «Filtrar». */
		applied?: AppliedFilter[];
		/** The list with no filters; shown when any is applied. */
		clearHref?: string;
		/** Start with the filters unfolded (after a validation error in one of them). */
		open?: boolean;
		/** The other filter fields. Omit when the list only has the search. */
		filters?: Snippet;
	} = $props();
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- hrefs are resolved by the caller -->
<form method="GET" {action} class="flex flex-col gap-3" role="search" data-filter-bar>
	{#if searchName && searchLabel}
		<div class="flex items-end gap-2">
			<div class="min-w-0 flex-1 min-[720px]:max-w-80">
				<Field label={searchLabel} error={searchError}>
					<TextInput name={searchName} value={searchValue} {inputmode} autocomplete="off" />
				</Field>
			</div>
			<Button type="submit" variant="primary" icon="search">Buscar</Button>
		</div>
	{/if}

	{#if filters}
		<details class="group rounded-md border border-border bg-surface" {open}>
			<summary
				class="flex min-h-touch cursor-pointer list-none items-center gap-2 rounded-md px-4 text-label hover:bg-surface-hover [&::-webkit-details-marker]:hidden"
			>
				<span class="text-muted transition-transform group-open:rotate-180"
					><Glyph name="chevron-down" /></span
				>
				Filtrar
				{#if applied.length}
					<span
						class="rounded-full bg-primary-soft px-2 text-caption text-primary-text"
						data-filter-count
						>{applied.length}
						<span class="sr-only"
							>{applied.length === 1 ? 'filtro aplicado' : 'filtros aplicados'}</span
						></span
					>
				{/if}
			</summary>
			<div class="flex flex-col gap-4 px-4 pb-4">
				{@render filters()}
				<div><Button type="submit">Aplicar filtros</Button></div>
			</div>
		</details>
	{/if}

	{#if applied.length}
		<ul class="m-0 flex list-none flex-wrap items-center gap-2 p-0" aria-label="Filtros aplicados">
			{#each applied as filter (filter.label)}
				<li>
					<a
						href={filter.removeHref}
						aria-label="Quitar el filtro {filter.label}"
						class="inline-flex min-h-control-sm items-center gap-1.5 rounded-full border border-border-strong bg-surface px-3 text-body-sm text-text hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus pointer-coarse:min-h-touch"
						>{filter.label}<Glyph name="x" size={14} /></a
					>
				</li>
			{/each}
			{#if clearHref}
				<li>
					<a
						href={clearHref}
						class="inline-flex min-h-control-sm items-center rounded-sm px-1 text-body-sm text-primary-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus pointer-coarse:min-h-touch"
						>Quitar todos</a
					>
				</li>
			{/if}
		</ul>
	{/if}
</form>

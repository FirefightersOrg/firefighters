<script lang="ts" module>
	export type BondNumberSize = 'sm' | 'md' | 'lg';
</script>

<script lang="ts">
	import { formatPaddedNumber } from '$lib/format';

	/**
	 * A bond number as it is printed on the paper stub: zero-padded, in the figure face, never broken
	 * across lines. The associated number, when given, follows it smaller. It is how a bond is named
	 * in lists, records and forms, so people always look for the same shape.
	 */
	let {
		number,
		associated = null,
		digits = 4,
		size = 'md',
		href
	}: {
		/** The base number. A `number` is zero-padded to `digits`; a string is shown as given. */
		number: number | string;
		/** The associated number, shown after the base one. */
		associated?: number | string | null;
		/** The campaign's number of digits, used to pad numeric values. */
		digits?: number;
		size?: BondNumberSize;
		/** Makes the number a link (to the bond record). Resolved by the caller. */
		href?: string;
	} = $props();

	const pad = (value: number | string) =>
		typeof value === 'number' ? formatPaddedNumber(value, digits) : value;

	const SIZE_CLASS: Record<BondNumberSize, string> = {
		sm: 'text-[16px] leading-5',
		md: 'text-[20px] leading-6',
		lg: 'text-[28px] leading-8'
	};
</script>

{#snippet figures()}
	<span class="font-figure font-bold tracking-wide tabular-nums {SIZE_CLASS[size]}"
		>{pad(number)}</span
	>{#if associated !== null && associated !== undefined && associated !== ''}<span
			class="font-sans text-body-sm font-medium text-subtle tabular-nums">/ {pad(associated)}</span
		>{/if}
{/snippet}

<!-- eslint-disable svelte/no-navigation-without-resolve -- hrefs are resolved by the caller -->
{#if href}
	<a
		{href}
		data-bond-number
		class="inline-flex min-h-touch items-baseline gap-1 rounded-sm whitespace-nowrap text-primary-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:min-h-0"
		>{@render figures()}</a
	>
{:else}
	<span data-bond-number class="inline-flex items-baseline gap-1 whitespace-nowrap text-text"
		>{@render figures()}</span
	>
{/if}

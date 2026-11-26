<script lang="ts" module>
	/** `screen`: whole pesos when the amount is whole. `document`: always with cents. */
	export type MoneyContext = 'screen' | 'document';
</script>

<script lang="ts">
	import { formatMoney } from '$lib/format';

	/**
	 * An amount of money. One rule per context (docs/copy.md): screens show whole pesos when there are
	 * no cents; printable documents and ledgers always show cents. The `$` and the figure never break
	 * across lines, and a negative amount is read as «menos», not as a hyphen.
	 */
	let {
		value,
		context = 'screen',
		class: className = ''
	}: {
		/** A number or a decimal string (`"1500.50"`). Null and invalid values print «—». */
		value: number | string | null | undefined;
		context?: MoneyContext;
		class?: string;
	} = $props();

	const negative = $derived(
		typeof value === 'number' ? value < 0 : typeof value === 'string' && /^\s*-/.test(value)
	);
	const absolute = $derived(
		typeof value === 'number'
			? Math.abs(value)
			: typeof value === 'string'
				? value.trim().replace(/^-/, '')
				: value
	);
	const text = $derived(
		formatMoney(absolute, { decimals: context === 'document' ? 'always' : 'auto' })
	);
</script>

<span class="whitespace-nowrap tabular-nums {className}" data-money
	>{#if negative}<span aria-hidden="true">−</span><span class="sr-only">menos</span
		>&nbsp;{/if}{text}</span
>

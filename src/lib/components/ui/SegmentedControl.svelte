<script lang="ts" module>
	export interface SegmentedOption {
		value: string;
		label: string;
		disabled?: boolean;
	}
</script>

<script lang="ts">
	import { cn } from './cn';

	/**
	 * A choice between two or three options that stay in view: adjacent buttons instead of a dropdown
	 * (Efectivo / Transferencia, Pago total / En cuotas). Native radios underneath, so Tab enters the
	 * group, the arrow keys move and select, and it posts with the form without JavaScript.
	 */
	let {
		legend,
		options,
		value = $bindable(),
		defaultValue,
		name,
		hideLegend = false,
		disabled = false,
		onchange
	}: {
		/** Names the group. Visible above it unless `hideLegend`. */
		legend: string;
		/** Two or three options; more belong in a `Select` or a `RadioGroup`. */
		options: SegmentedOption[];
		value?: string;
		/** Initial value when not bound. */
		defaultValue?: string;
		/** Form field name; generated when omitted so the arrow keys still move within the group. */
		name?: string;
		hideLegend?: boolean;
		disabled?: boolean;
		onchange?: (value: string) => void;
	} = $props();

	const uid = $props.id();
	const groupName = $derived(name ?? `segmented-${uid}`);

	// Not bound: start from `defaultValue`.
	// svelte-ignore state_referenced_locally
	if (value === undefined && defaultValue !== undefined) value = defaultValue;

	function select(next: string) {
		value = next;
		onchange?.(next);
	}
</script>

<fieldset class="m-0 min-w-0 border-0 p-0" {disabled}>
	<legend class={hideLegend ? 'sr-only' : 'mb-1 p-0 text-label text-text'}>{legend}</legend>
	<div
		class="grid auto-cols-fr grid-flow-col overflow-hidden rounded-md border border-border-strong bg-surface"
	>
		{#each options as option, i (option.value)}
			{@const optionDisabled = disabled || option.disabled}
			<label
				class={cn(
					'relative flex min-h-control-md cursor-pointer items-center justify-center gap-1.5 px-3 text-label text-muted pointer-coarse:min-h-touch',
					'has-checked:bg-primary has-checked:font-semibold has-checked:text-on-primary',
					'has-focus-visible:z-[1] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus',
					i > 0 && 'border-l border-border-strong',
					optionDisabled && 'cursor-not-allowed text-disabled'
				)}
			>
				<input
					type="radio"
					class="peer sr-only"
					name={groupName}
					value={option.value}
					checked={value === option.value}
					disabled={optionDisabled}
					onchange={() => select(option.value)}
				/>
				<!-- The check is a second signal besides the fill, so the choice does not depend on colour. -->
				<svg
					class="hidden shrink-0 peer-checked:block"
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="m5 12 5 5 9-10" />
				</svg>
				{option.label}
			</label>
		{/each}
	</div>
</fieldset>

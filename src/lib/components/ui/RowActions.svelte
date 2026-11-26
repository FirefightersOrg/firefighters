<script lang="ts" module>
	export interface RowAction {
		label: string;
		/** Runs the action. For a destructive one, open a `Dialog` here: never act straight away. */
		onselect?: () => void;
		/** Or go somewhere. Resolved by the caller. */
		href?: string;
		/** Marks a destructive entry (it still has to confirm in a dialog). */
		tone?: 'danger';
	}
</script>

<script lang="ts">
	/**
	 * The rare actions of one row behind a single «…» control, so a list does not carry a reason field
	 * and a remove button on every line. A disclosure with a short list of actions: Esc or a click
	 * outside closes it and focus goes back to the control.
	 */
	let {
		label,
		actions
	}: {
		/** What the control acts on («Acciones del pago del bono 0019»): it has no visible text. */
		label: string;
		actions: RowAction[];
	} = $props();

	let open = $state(false);
	let root = $state<HTMLDetailsElement>();
	let trigger = $state<HTMLElement>();

	function close(returnFocus: boolean) {
		open = false;
		if (returnFocus) trigger?.focus();
	}
	function choose(action: RowAction) {
		close(true);
		action.onselect?.();
	}
</script>

<svelte:window
	onkeydown={(event) => {
		if (open && event.key === 'Escape') close(true);
	}}
	onclick={(event) => {
		if (open && root && !root.contains(event.target as Node)) close(false);
	}}
/>

<!-- eslint-disable svelte/no-navigation-without-resolve -- hrefs are resolved by the caller -->
<details
	bind:this={root}
	class="relative"
	{open}
	ontoggle={(event) => (open = event.currentTarget.open)}
	data-row-actions
>
	<summary
		bind:this={trigger}
		aria-label={label}
		aria-expanded={open}
		class="inline-flex size-touch cursor-pointer list-none items-center justify-center rounded-md text-muted hover:bg-surface-hover hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus [&::-webkit-details-marker]:hidden"
	>
		<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<circle cx="5" cy="12" r="1.75" /><circle cx="12" cy="12" r="1.75" /><circle
				cx="19"
				cy="12"
				r="1.75"
			/>
		</svg>
	</summary>
	<ul
		class="absolute right-0 z-[var(--z-dropdown)] m-0 mt-1 min-w-48 list-none rounded-md border border-border bg-surface-raised p-1 shadow-lg"
	>
		{#each actions as action (action.label)}
			{@const itemClass = `flex min-h-touch w-full cursor-pointer items-center rounded-sm border-0 bg-transparent px-3 text-left text-label whitespace-nowrap hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus ${action.tone === 'danger' ? 'text-danger-text' : 'text-text'}`}
			<li>
				{#if action.href}
					<a href={action.href} class={itemClass} onclick={() => close(false)}>{action.label}</a>
				{:else}
					<button type="button" class={itemClass} onclick={() => choose(action)}
						>{action.label}</button
					>
				{/if}
			</li>
		{/each}
	</ul>
</details>

<script lang="ts">
	/** Highlighted figure with its label. `value` arrives already formatted (es-AR). */
	let { label, value, detail }: { label: string; value: string; detail?: string } = $props();
</script>

<div class="flex flex-col gap-1 rounded-lg border border-border bg-surface px-4 py-4 sm:px-6">
	<span class="text-label text-muted">{label}</span>
	<span class="text-number-lg tabular-nums">{value}</span>
	{#if detail}<span class="text-body-sm text-muted">{detail}</span>{/if}
</div>

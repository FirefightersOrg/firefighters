<script lang="ts">
	import { Stat } from '$lib/components/ui';
	import { importSummarySentences } from '$lib/domain/import-preview';
	import { formatNumber } from '$lib/format';
	import type { ImportSessionSummary } from '$lib/server/services/imports';

	/** The seven preview metrics of docs/imports.md, with blocking errors called out in words. */
	let { summary }: { summary: ImportSessionSummary } = $props();

	const metrics = $derived([
		{ label: 'Bonos simples', value: summary.simpleItems },
		{ label: 'Patas', value: summary.pataGroups },
		{ label: 'Números base', value: summary.baseNumbers },
		{ label: 'Números participantes', value: summary.participatingNumbers },
		{
			label: 'Errores',
			value: summary.errors,
			detail: summary.errors > 0 ? 'Impiden confirmar' : undefined
		},
		{
			label: 'Observaciones',
			value: summary.warnings,
			detail: summary.warnings > 0 ? 'Revisar antes de confirmar' : undefined
		},
		{
			label: 'Duplicados',
			value: summary.duplicates,
			detail: summary.duplicates > 0 ? 'Repetidos o ya en uso' : undefined
		}
	]);
</script>

<p class="m-0 mb-3 text-body {summary.errors > 0 ? 'text-danger-text' : 'text-text'}">
	{importSummarySentences(summary).join(' ')}
</p>
<div
	class="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7"
	role="group"
	aria-label="Resumen de la importación"
>
	{#each metrics as metric (metric.label)}
		<Stat label={metric.label} value={formatNumber(metric.value)} detail={metric.detail} />
	{/each}
</div>
{#if summary.pending > 0 || summary.removedItems > 0}
	<p class="m-0 mt-2 text-body-sm text-muted">
		{#if summary.pending > 0}{formatNumber(summary.pending)}
			{summary.pending === 1 ? 'fila pendiente' : 'filas pendientes'} de validación.{/if}
		{#if summary.removedItems > 0}{formatNumber(summary.removedItems)}
			{summary.removedItems === 1 ? 'fila quitada' : 'filas quitadas'} (se conservan como historial).{/if}
	</p>
{/if}

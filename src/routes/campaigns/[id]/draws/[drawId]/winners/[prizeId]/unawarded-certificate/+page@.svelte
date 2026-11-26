<script lang="ts">
	import '$lib/styles/print.css';
	import type { PageProps } from './$types';

	/** Printable unawarded prize certificate (docs/documents.md). Styles: `$lib/styles/print.css`. */
	let { data }: PageProps = $props();
	const doc = $derived(data.document);
	const fields = $derived([
		['Sorteo', doc.draw],
		['Premio', doc.prize],
		['Número ganador', doc.winningNumber],
		['Bono asociado', doc.associatedBond],
		['Comprador', doc.buyer],
		['Motivo de la no adjudicación', doc.reason],
		['Estado en el padrón', doc.rosterStatus],
		['Registrado por', doc.registeredBy],
		['Fecha', doc.date],
		['Observaciones', doc.notes]
	]);
</script>

<svelte:head><title>Constancia de premio no adjudicado - {doc.draw}</title></svelte:head>
<main>
	<div class="doc-toolbar">
		<button type="button" onclick={() => window.print()}>Imprimir</button>
	</div>
	<article class="doc-sheet">
		<header class="doc-header">
			<div>
				<p class="doc-institution">{doc.institutionName}</p>
				<h1 class="doc-title">Constancia de premio no adjudicado</h1>
			</div>
		</header>
		<dl class="doc-fields doc-fields-2">
			{#each fields as [label, value] (label)}
				<div>
					<dt>{label}</dt>
					<dd class:doc-bond={label === 'Número ganador' || label === 'Bono asociado'}>{value}</dd>
				</div>
			{/each}
		</dl>
	</article>
</main>

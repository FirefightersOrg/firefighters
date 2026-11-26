<script lang="ts">
	import '$lib/styles/print.css';
	import type { PageProps } from './$types';

	/** Printable prize delivery certificate (docs/documents.md). Styles: `$lib/styles/print.css`. */
	let { data }: PageProps = $props();
	const doc = $derived(data.document);
	const fields = $derived([
		['Sorteo', doc.draw],
		['Fecha del sorteo', doc.drawDate],
		['Premio', doc.prize],
		['Número ganador', doc.winningNumber],
		['Bono asociado', doc.associatedBond],
		['Comprador', doc.buyer],
		['Cobrador', doc.collector],
		['Estado en el padrón', doc.rosterStatus],
		['Fecha de entrega', doc.deliveryDate],
		['Registrado por', doc.registeredBy],
		['Observaciones', doc.notes]
	]);
</script>

<svelte:head><title>Constancia de entrega de premio - {doc.draw}</title></svelte:head>
<main>
	<div class="doc-toolbar">
		<button type="button" onclick={() => window.print()}>Imprimir</button>
	</div>
	<article class="doc-sheet">
		<header class="doc-header">
			<div>
				<p class="doc-institution">{doc.institutionName}</p>
				<h1 class="doc-title">Constancia de entrega de premio</h1>
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
		<div class="doc-signatures">
			<div>
				<span class="doc-line"></span>{doc.recipientSignature}<br /><small
					>{doc.recipientName} y {doc.recipientDocument}</small
				>
			</div>
		</div>
	</article>
</main>

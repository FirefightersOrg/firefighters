<script lang="ts">
	import '$lib/styles/print.css';
	import type { PageProps } from './$types';

	/** Printable payment certificate (comprobante de pago). Styles: `$lib/styles/print.css`. */
	let { data }: PageProps = $props();
	const doc = $derived(data.document);
</script>

<svelte:head><title>{doc.receiptNumber} - {doc.campaign}</title></svelte:head>
<main>
	<div class="doc-toolbar">
		<button type="button" onclick={() => window.print()}>Imprimir</button>
	</div>
	<article class="doc-sheet">
		<header class="doc-header">
			<div>
				<p class="doc-institution">{doc.institutionName}</p>
				<h1 class="doc-title">Comprobante de pago</h1>
				<p>{doc.campaign}</p>
			</div>
			<div class="doc-meta">
				<p class="doc-number">{doc.receiptNumber}</p>
			</div>
		</header>
		{#if doc.legend}
			<section class="doc-legend" aria-label="Estado del comprobante">
				<strong>{doc.legend.label}</strong>
				<p>{doc.legend.detail}</p>
				{#if doc.legend.reference}<p>{doc.legend.reference}</p>{/if}
			</section>
		{/if}
		<dl class="doc-fields doc-fields-2">
			<div>
				<dt>Bono</dt>
				<dd class="doc-bond">{doc.bond}</dd>
			</div>
			<div>
				<dt>Comprador</dt>
				<dd>{doc.buyer}</dd>
			</div>
			<div>
				<dt>Cobrador</dt>
				<dd>{doc.collector}</dd>
			</div>
			<div>
				<dt>Cuotas cubiertas</dt>
				<dd>{doc.installments}</dd>
			</div>
			<div>
				<dt>Importe</dt>
				<dd>{doc.amount}</dd>
			</div>
			<div>
				<dt>Medio de pago</dt>
				<dd>{doc.method}</dd>
			</div>
			<div>
				<dt>Fecha de pago</dt>
				<dd>{doc.paymentDate}</dd>
			</div>
			<div>
				<dt>Fecha de registro</dt>
				<dd>{doc.createdAt}</dd>
			</div>
			<div>
				<dt>Registrado por</dt>
				<dd>{doc.registeredBy}</dd>
			</div>
		</dl>
	</article>
</main>

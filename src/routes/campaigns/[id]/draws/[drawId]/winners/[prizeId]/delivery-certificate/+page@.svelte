<script lang="ts">
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	const doc = $derived(data.document);
</script>

<svelte:head><title>Prize delivery certificate - {doc.draw}</title></svelte:head>
<div class="toolbar"><button type="button" onclick={() => window.print()}>Print</button></div>
<article class="sheet">
	<header>
		<p class="institution">{doc.institutionName}</p>
		<h1>Prize delivery certificate</h1>
	</header>
	<dl>
		<div>
			<dt>Draw</dt>
			<dd>{doc.draw}</dd>
		</div>
		<div>
			<dt>Draw date</dt>
			<dd>{doc.drawDate}</dd>
		</div>
		<div>
			<dt>Prize</dt>
			<dd>{doc.prize}</dd>
		</div>
		<div>
			<dt>Winning number</dt>
			<dd>{doc.winningNumber}</dd>
		</div>
		<div>
			<dt>Associated bond</dt>
			<dd>{doc.associatedBond}</dd>
		</div>
		<div>
			<dt>Buyer</dt>
			<dd>{doc.buyer}</dd>
		</div>
		<div>
			<dt>Collector</dt>
			<dd>{doc.collector}</dd>
		</div>
		<div>
			<dt>Roster status</dt>
			<dd>{doc.rosterStatus}</dd>
		</div>
		<div>
			<dt>Delivery date</dt>
			<dd>{doc.deliveryDate}</dd>
		</div>
		<div>
			<dt>Registered by</dt>
			<dd>{doc.registeredBy}</dd>
		</div>
		<div class="wide">
			<dt>Notes</dt>
			<dd>{doc.notes}</dd>
		</div>
	</dl>
	<section class="signature">
		<div><span></span><strong>{doc.recipientSignature}</strong></div>
		<div><span></span><strong>{doc.recipientName}</strong></div>
		<div><span></span><strong>{doc.recipientDocument}</strong></div>
	</section>
</article>

<style>
	:global(body) {
		background: #fff;
		color: #000;
	}
	.toolbar {
		padding: 1rem;
		text-align: right;
	}
	.sheet {
		max-width: 190mm;
		margin: auto;
		padding: 10mm;
		border: 1px solid #ddd;
	}
	header {
		border-bottom: 2px solid #000;
	}
	.institution {
		font-weight: 700;
	}
	dl {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 1rem;
		margin-top: 1rem;
	}
	.wide {
		grid-column: 1 / -1;
	}
	dt {
		font-size: 9pt;
		color: #444;
	}
	dd {
		margin: 0;
		font-weight: 600;
		white-space: pre-wrap;
	}
	.signature {
		display: grid;
		grid-template-columns: 2fr 2fr 1fr;
		gap: 1rem;
		margin-top: 25mm;
	}
	.signature span {
		display: block;
		border-top: 1px solid #000;
	}
	.signature strong {
		display: block;
		padding-top: 2mm;
		text-align: center;
		font-size: 9pt;
	}
	@media print {
		.toolbar {
			display: none;
		}
		.sheet {
			border: none;
			padding: 0;
			max-width: none;
		}
		@page {
			size: A4;
			margin: 12mm;
		}
	}
</style>

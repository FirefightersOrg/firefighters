<script lang="ts">
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	const doc = $derived(data.document);
</script>

<svelte:head><title>{doc.receiptNumber} - {doc.campaign}</title></svelte:head>
<div class="toolbar"><button type="button" onclick={() => window.print()}>Print</button></div>
<article class="sheet">
	<header>
		<div>
			<p class="institution">{doc.institutionName}</p>
			<h1>Payment certificate</h1>
			<p>{doc.campaign}</p>
		</div>
		<div><strong>{doc.receiptNumber}</strong></div>
	</header>
	<dl>
		<div>
			<dt>Bond</dt>
			<dd>{doc.bond}</dd>
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
			<dt>Covered installments</dt>
			<dd>{doc.installments}</dd>
		</div>
		<div>
			<dt>Amount</dt>
			<dd>{doc.amount}</dd>
		</div>
		<div>
			<dt>Payment method</dt>
			<dd>{doc.method}</dd>
		</div>
		<div>
			<dt>Payment date</dt>
			<dd>{doc.paymentDate}</dd>
		</div>
		<div>
			<dt>Registration date</dt>
			<dd>{doc.createdAt}</dd>
		</div>
		<div>
			<dt>Registered by</dt>
			<dd>{doc.registeredBy}</dd>
		</div>
	</dl>
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
		display: flex;
		justify-content: space-between;
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
	dt {
		font-size: 9pt;
		color: #444;
	}
	dd {
		margin: 0;
		font-weight: 600;
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

<script lang="ts">
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	const doc = $derived(data.document);
	const copies = ['ORIGINAL – Administration', 'DUPLICATE – Collector'];
</script>

<svelte:head><title>{doc.settlementNumberLabel} - {doc.campaign}</title></svelte:head>
<div class="toolbar"><button type="button" onclick={() => window.print()}>Print</button></div>
{#each copies as copy (copy)}
	<article class="sheet">
		<header>
			<div>
				<p class="institution">{doc.institutionName}</p>
				<h1>Settlement delivery note</h1>
				<p>{doc.campaign}</p>
				{#if doc.preliminary}<p class="preliminary">PRELIMINARY / DRAFT — OPEN SETTLEMENT</p>{/if}
				{#if doc.status === 'annulled'}
					<p class="preliminary">ANULADA — ANNULLED SETTLEMENT — NOT VALID</p>
				{:else if doc.status === 'corrected'}
					<p class="preliminary">CORREGIDA — CORRECTED SETTLEMENT — NOT VALID</p>
				{/if}
			</div>
			<div class="meta">
				<p class="copy">{copy}</p>
				<p><strong>{doc.settlementNumberLabel}</strong></p>
			</div>
		</header>
		<dl>
			<div>
				<dt>Opening date</dt>
				<dd>{doc.openingDate}</dd>
			</div>
			<div>
				<dt>Closing date</dt>
				<dd>{doc.closingDate}</dd>
			</div>
			<div>
				<dt>Collector</dt>
				<dd>{doc.collector}</dd>
			</div>
			<div>
				<dt>Closed by</dt>
				<dd>{doc.closedBy ?? '—'}</dd>
			</div>
		</dl>
		<table>
			<thead
				><tr><th>Bond</th><th>Buyer</th><th>Paid installments</th><th>Method</th><th>Amount</th></tr
				></thead
			><tbody
				>{#each doc.payments as payment, i (i)}<tr
						><td>{payment.bond}</td><td>{payment.buyer}</td><td>{payment.installments}</td><td
							>{payment.method}</td
						><td>{payment.amount}</td></tr
					>{/each}</tbody
			>
		</table>
		<dl class="totals">
			<div>
				<dt>Cash total</dt>
				<dd>{doc.totals.cash}</dd>
			</div>
			<div>
				<dt>Transfer total</dt>
				<dd>{doc.totals.transfer}</dd>
			</div>
			<div>
				<dt>Grand total</dt>
				<dd>{doc.totals.amount}</dd>
			</div>
			<div>
				<dt>Generated commission</dt>
				<dd>{doc.totals.commission}</dd>
			</div>
			<div>
				<dt>Settled commission</dt>
				<dd>{doc.totals.commissionPaid}</dd>
			</div>
			<div>
				<dt>Manual adjustments</dt>
				<dd>{doc.manualAdjustments}</dd>
			</div>
			<div>
				<dt>Net for Firefighters</dt>
				<dd>{doc.totals.net}</dd>
			</div>
			<div>
				<dt>Resulting collector balance</dt>
				<dd>{doc.totals.balance}</dd>
			</div>
		</dl>
		<p><strong>Notes:</strong> {doc.notes ?? '—'}</p>
		<div class="signatures">
			<div><span></span>{doc.collectorSignature}</div>
			<div><span></span>{doc.administrationSignature}</div>
		</div>
	</article>{/each}

<style>
	:global(body) {
		background: #fff;
		color: #000;
	}
	.toolbar {
		padding: 1rem;
		text-align: right;
	}
	.toolbar button {
		border: 1px solid #333;
		padding: 0.4rem 1rem;
	}
	.sheet {
		max-width: 190mm;
		margin: 0 auto 2rem;
		padding: 10mm;
		font-size: 10pt;
		border: 1px solid #ddd;
	}
	header {
		display: flex;
		justify-content: space-between;
		border-bottom: 2px solid #000;
	}
	.institution,
	.copy {
		font-weight: 700;
	}
	.meta {
		text-align: right;
	}
	.preliminary {
		font-weight: 700;
		border: 2px solid #b00020;
		padding: 0.25rem;
		color: #b00020;
	}
	dl {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 2rem;
		margin: 0.75rem 0;
	}
	dl div {
		min-width: 20%;
	}
	dt {
		font-size: 9pt;
		color: #444;
	}
	dd {
		margin: 0;
		font-weight: 600;
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	th,
	td {
		border: 1px solid #999;
		padding: 0.25rem;
		text-align: left;
	}
	.signatures {
		display: flex;
		gap: 3rem;
		margin-top: 3rem;
		text-align: center;
	}
	.signatures div {
		flex: 1;
	}
	.signatures span {
		display: block;
		border-top: 1px solid #000;
		margin-bottom: 0.25rem;
	}
	@media print {
		.toolbar {
			display: none;
		}
		.sheet {
			border: none;
			margin: 0;
			padding: 0;
			max-width: none;
			break-after: page;
		}
		.sheet:last-of-type {
			break-after: auto;
		}
		@page {
			size: A4;
			margin: 12mm;
		}
	}
</style>

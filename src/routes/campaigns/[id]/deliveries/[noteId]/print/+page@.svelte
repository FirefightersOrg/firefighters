<script lang="ts">
	import type { PageProps } from './$types';

	/**
	 * Printable bond delivery note (docs/documents.md): two copies, ORIGINAL for administration and
	 * DUPLICATE for the collector, each with the 13 fields and both signature lines. `+page@` resets
	 * to the root layout, so the app navigation is not printed.
	 */
	let { data }: PageProps = $props();
	const doc = $derived(data.document);
	const copies = ['ORIGINAL – Administration', 'DUPLICATE – Collector'];
	const collectorSignature = $derived(
		doc.reason === 'return'
			? 'Collector signature — I HANDED the bonds back'
			: doc.collectorSignature
	);
</script>

<svelte:head>
	<title>{doc.deliveryNoteNumber} - {doc.campaign}</title>
</svelte:head>

<div class="toolbar">
	<button type="button" onclick={() => window.print()}>Print</button>
</div>

{#each copies as copy (copy)}
	<article class="sheet">
		<header>
			<div>
				<p class="institution">{doc.institutionName}</p>
				<h1>
					{doc.reason === 'return'
						? 'Bond return note'
						: doc.reason === 'reassignment'
							? 'Reassignment'
							: 'Bond delivery note'}
				</h1>
				{#if doc.status === 'annulled'}<p class="annulled">ANNULLED</p>{/if}
				<p>{doc.campaign}</p>
			</div>
			<div class="meta">
				<p class="copy">{copy}</p>
				<p><strong>{doc.deliveryNoteNumber}</strong></p>
				<p>Date: {doc.date}</p>
			</div>
		</header>

		<dl>
			<div>
				<dt>Collector</dt>
				<dd>{doc.collector}</dd>
			</div>
			<div>
				<dt>Registered by</dt>
				<dd>{doc.registeredBy}</dd>
			</div>
		</dl>

		<table>
			<thead>
				<tr
					><th>#</th><th>Type</th><th>Base / associated numbers</th><th>Barcode</th><th>Units</th
					></tr
				>
			</thead>
			<tbody>
				{#each doc.deliveredBonds as bond, i (i)}
					<tr>
						<td>{i + 1}</td>
						<td>{bond.type}</td>
						<td>
							{#each bond.numbers as n, j (j)}
								<span class="number">{n.base}{n.associated ? ` / ${n.associated}` : ''}</span>
							{/each}
						</td>
						<td>
							{#if bond.barcode}<span class="number">{bond.barcode}</span>{/if}
							{#each bond.numbers.filter((n) => n.barcode) as n, j (j)}
								<span class="number">{n.barcode}</span>
							{/each}
							{#if !bond.barcode && !bond.numbers.some((n) => n.barcode)}—{/if}
						</td>
						<td>{bond.units}</td>
					</tr>
				{/each}
			</tbody>
			<tfoot>
				<tr><td colspan="4">Total: {doc.bondCount} bonds</td><td>{doc.unitCount}</td></tr>
			</tfoot>
		</table>

		<p class="notes"><strong>Notes:</strong> {doc.notes ?? '—'}</p>

		<div class="signatures">
			<div><span class="line"></span>{collectorSignature}<br /><small>Name and ID</small></div>
			<div>
				<span class="line"></span>{doc.administrationSignature}<br /><small>Name and ID</small>
			</div>
		</div>
	</article>
{/each}

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
		border-radius: 0.375rem;
		padding: 0.4rem 1rem;
		cursor: pointer;
	}
	.sheet {
		max-width: 190mm;
		margin: 0 auto 2rem;
		padding: 10mm;
		font-size: 11pt;
		border: 1px solid #ddd;
	}
	header {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		border-bottom: 2px solid #000;
		padding-bottom: 0.5rem;
	}
	h1 {
		font-size: 16pt;
		margin: 0.2rem 0;
	}
	.institution {
		font-weight: 700;
		text-transform: uppercase;
	}
	.meta {
		text-align: right;
	}
	.copy {
		font-weight: 700;
		letter-spacing: 0.05em;
	}
	.annulled {
		color: #b00020;
		font-size: 14pt;
		font-weight: 700;
		letter-spacing: 0.1em;
	}
	dl {
		display: flex;
		gap: 2rem;
		margin: 0.75rem 0;
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
		padding: 0.25rem 0.4rem;
		text-align: left;
		vertical-align: top;
	}
	.number {
		display: block;
		font-family: ui-monospace, monospace;
	}
	tfoot td {
		font-weight: 700;
	}
	.notes {
		margin: 0.75rem 0;
	}
	.signatures {
		display: flex;
		justify-content: space-between;
		gap: 3rem;
		margin-top: 3rem;
		text-align: center;
	}
	.signatures > div {
		flex: 1;
	}
	.line {
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

<script lang="ts">
	import '$lib/styles/print.css';
	import type { PrintableDeliveryNote } from '$lib/server/documents/delivery-note';

	/**
	 * Printable bond delivery note (docs/documents.md): two copies, ORIGINAL for administration and
	 * DUPLICADO for the collector, each with the 13 fields and both signature lines. The same page
	 * prints the return note (reason `return`). `+page@` resets to the root layout, so the app
	 * navigation is not printed. Shared by the operator and the collector portal print routes (SAN-153). Styles live in `$lib/styles/print.css` (Cimiento, SAN-138).
	 */
	let { document: doc }: { document: PrintableDeliveryNote } = $props();
	const copies = ['ORIGINAL – Administración', 'DUPLICADO – Cobrador'];
	const collectorSignature = $derived(
		doc.reason === 'return' ? 'Firma del cobrador — DEVOLVIÓ los bonos' : doc.collectorSignature
	);
</script>

<svelte:head>
	<title>{doc.deliveryNoteNumber} - {doc.campaign}</title>
</svelte:head>

<main>
	<div class="doc-toolbar">
		<button type="button" onclick={() => window.print()}>Imprimir</button>
	</div>

	{#each copies as copy (copy)}
		<article class="doc-sheet">
			<header class="doc-header">
				<div>
					<p class="doc-institution">{doc.institutionName}</p>
					<h1 class="doc-title">
						{doc.reason === 'return'
							? 'Remito de devolución de bonos'
							: doc.reason === 'reassignment'
								? 'Reasignación de bonos'
								: 'Remito de entrega de bonos'}
					</h1>
					{#if doc.status === 'annulled'}<p class="doc-legend">ANULADO</p>{/if}
					<p>{doc.campaign}</p>
				</div>
				<div class="doc-meta">
					<p class="doc-copy">{copy}</p>
					<p class="doc-number">{doc.deliveryNoteNumber}</p>
					<p>Fecha: {doc.date}</p>
				</div>
			</header>

			<dl class="doc-fields">
				<div>
					<dt>Cobrador</dt>
					<dd>{doc.collector}</dd>
				</div>
				<div>
					<dt>Registrado por</dt>
					<dd>{doc.registeredBy}</dd>
				</div>
			</dl>

			<table class="doc-table">
				<thead>
					<tr>
						<th>N.º</th>
						<th>Tipo</th>
						<th>Números base / asociados</th>
						<th>Código de barras</th>
						<th class="num">Unidades</th>
					</tr>
				</thead>
				<tbody>
					{#each doc.deliveredBonds as bond, i (i)}
						<tr>
							<td class="num">{i + 1}</td>
							<td>{bond.type}</td>
							<td>
								<div class="doc-bond-grid">
									{#each bond.numbers as n, j (j)}
										<span class="doc-bond">{n.base}{n.associated ? ` / ${n.associated}` : ''}</span>
									{/each}
								</div></td
							>
							<td>
								{#if bond.barcode}<span class="doc-code">{bond.barcode}</span>{/if}
								{#each bond.numbers.filter((n) => n.barcode) as n, j (j)}
									<span class="doc-code">{n.barcode}</span>
								{/each}
								{#if !bond.barcode && !bond.numbers.some((n) => n.barcode)}—{/if}
							</td>
							<td class="num">{bond.units}</td>
						</tr>
					{/each}
				</tbody>
				<tfoot>
					<tr>
						<td colspan="4">Total: {doc.bondCount} {doc.bondCount === 1 ? 'bono' : 'bonos'}</td>
						<td class="num">{doc.unitCount}</td>
					</tr>
				</tfoot>
			</table>

			<p class="doc-notes"><strong>Observaciones:</strong> {doc.notes ?? '—'}</p>

			<div class="doc-signatures">
				<div>
					<span class="doc-line"></span>{collectorSignature}<br /><small>Aclaración y DNI</small>
				</div>
				<div>
					<span class="doc-line"></span>{doc.administrationSignature}<br /><small
						>Aclaración y DNI</small
					>
				</div>
			</div>
		</article>
	{/each}
</main>

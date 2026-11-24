<script lang="ts">
	import '$lib/styles/print.css';
	import type { PageProps } from './$types';

	/** Printable settlement delivery note (remito de rendición), original and duplicate. Styles: `$lib/styles/print.css`. */
	let { data }: PageProps = $props();
	const doc = $derived(data.document);
	const copies = ['ORIGINAL – Administración', 'DUPLICADO – Cobrador'];
</script>

<svelte:head><title>{doc.settlementNumberLabel} - {doc.campaign}</title></svelte:head>
<div class="doc-toolbar">
	<button type="button" onclick={() => window.print()}>Imprimir</button>
</div>
{#each copies as copy (copy)}
	<article class="doc-sheet">
		<header class="doc-header">
			<div>
				<p class="doc-institution">{doc.institutionName}</p>
				<h1 class="doc-title">Remito de rendición</h1>
				<p>{doc.campaign}</p>
				{#if doc.preliminary}<p class="doc-legend doc-legend-draft">
						PRELIMINAR / BORRADOR — RENDICIÓN ABIERTA
					</p>{/if}
				{#if doc.status === 'annulled'}
					<p class="doc-legend">ANULADA — RENDICIÓN SIN VALIDEZ</p>
				{:else if doc.status === 'corrected'}
					<p class="doc-legend">CORREGIDA — RENDICIÓN SIN VALIDEZ</p>
				{/if}
				{#if doc.balanceSnapshotMissing}
					<p class="doc-legend doc-legend-draft">
						Saldo al cierre no registrado — documento histórico
					</p>
				{/if}
			</div>
			<div class="doc-meta">
				<p class="doc-copy">{copy}</p>
				<p class="doc-number">{doc.settlementNumberLabel}</p>
			</div>
		</header>
		<dl class="doc-fields">
			<div>
				<dt>Fecha de apertura</dt>
				<dd>{doc.openingDate}</dd>
			</div>
			<div>
				<dt>Fecha de cierre</dt>
				<dd>{doc.closingDate}</dd>
			</div>
			<div>
				<dt>Cobrador</dt>
				<dd>{doc.collector}</dd>
			</div>
			<div>
				<dt>Cerrada por</dt>
				<dd>{doc.closedBy ?? '—'}</dd>
			</div>
		</dl>
		<table class="doc-table">
			<thead>
				<tr>
					<th>Bono</th>
					<th>Comprador</th>
					<th>Cuotas pagadas</th>
					<th>Medio de pago</th>
					<th class="num">Importe</th>
				</tr>
			</thead>
			<tbody>
				{#each doc.payments as payment, i (i)}
					<tr>
						<td><span class="doc-code">{payment.bond}</span></td>
						<td>{payment.buyer}</td>
						<td>{payment.installments}</td>
						<td>{payment.method}</td>
						<td class="num">{payment.amount}</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<dl class="doc-fields">
			<div>
				<dt>Total en efectivo</dt>
				<dd>{doc.totals.cash}</dd>
			</div>
			<div>
				<dt>Total por transferencia</dt>
				<dd>{doc.totals.transfer}</dd>
			</div>
			<div>
				<dt>Total general</dt>
				<dd>{doc.totals.amount}</dd>
			</div>
			<div>
				<dt>Comisión generada</dt>
				<dd>{doc.totals.commission}</dd>
			</div>
			<div>
				<dt>Comisión liquidada</dt>
				<dd>{doc.totals.commissionPaid}</dd>
			</div>
			<div>
				<dt>Ajustes manuales</dt>
				<dd>{doc.manualAdjustments}</dd>
			</div>
			<div>
				<dt>Neto para Bomberos</dt>
				<dd>{doc.totals.net}</dd>
			</div>
			<div>
				<dt>Saldo resultante del cobrador</dt>
				<dd>{doc.totals.balance}</dd>
			</div>
		</dl>
		<p class="doc-notes"><strong>Observaciones:</strong> {doc.notes ?? '—'}</p>
		<div class="doc-signatures">
			<div><span class="doc-line"></span>{doc.collectorSignature}</div>
			<div><span class="doc-line"></span>{doc.administrationSignature}</div>
		</div>
	</article>
{/each}

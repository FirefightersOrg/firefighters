<script lang="ts">
	import { institutionName } from '$lib/institution';
	import { resolve } from '$app/paths';
	import { Alert, EmptyState, PageHeader, Section, StatusBadge, Table } from '$lib/components/ui';
	import type { TableColumn } from '$lib/components/ui';
	import {
		LEDGER_ENTRY_TYPE_LABELS,
		type LedgerEntryType,
		type LedgerStatus
	} from '$lib/domain/ledger';
	import { EMPTY_VALUE, formatDate, formatMoney } from '$lib/format';
	import type { SettlementStatus } from '$lib/domain/payments';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const money = (n: number) => formatMoney(n, { decimals: 'always' });

	const ledger = $derived(data.ledger);
	const entryRows = $derived(
		(ledger?.entries ?? []).map((entry) => ({
			id: entry.id,
			date: formatDate(entry.occurredAt),
			type: LEDGER_ENTRY_TYPE_LABELS[entry.entryType as LedgerEntryType] ?? entry.entryType,
			settlement: entry.settlementNumber ? `Rendición N.º ${entry.settlementNumber}` : EMPTY_VALUE,
			debit: entry.direction === 'collector_debit' ? money(entry.amount) : '',
			credit: entry.direction === 'collector_credit' ? money(entry.amount) : '',
			/** One amount with its sign, for the stacked row on a phone (no debit and credit columns). */
			signed:
				entry.direction === 'collector_debit'
					? `−\u00a0${money(entry.amount)}`
					: money(entry.amount),
			balance: money(entry.runningBalance),
			status: entry.status as LedgerStatus,
			reference: !entry.affectsBalance,
			reason: entry.adjustmentReason
		}))
	);
	type EntryRow = (typeof entryRows)[number];
	const entryColumns: TableColumn<EntryRow>[] = [
		{ key: 'date', header: 'Fecha', stack: 'primary' },
		{ key: 'type', header: 'Concepto', stack: 'secondary' },
		{ key: 'settlement', header: 'Rendición', stack: 'hidden' },
		{ key: 'debit', header: 'Débito', align: 'right', stack: 'hidden' },
		// On a phone this cell carries the amount with its sign.
		{ key: 'credit', header: 'Crédito', align: 'right', stack: 'trailing' },
		{ key: 'balance', header: 'Saldo', align: 'right' },
		{ key: 'status', header: 'Estado' }
	];

	const settlementRows = $derived(
		(ledger?.settlements ?? []).map((s) => ({
			id: s.id,
			number: `N.º ${s.number}`,
			date: formatDate(s.closedAt ?? s.openedAt),
			status: s.status,
			total: money(s.totalAmount),
			commission: money(s.commissionAmount),
			net: money(s.netToFirefighters)
		}))
	);
	type SettlementRow = (typeof settlementRows)[number];
	const settlementColumns: TableColumn<SettlementRow>[] = [
		{ key: 'number', header: 'Rendición', stack: 'primary' },
		{ key: 'net', header: 'A entregar', align: 'right', stack: 'trailing' },
		{ key: 'date', header: 'Fecha', stack: 'secondary' },
		{ key: 'status', header: 'Estado', stack: 'secondary' },
		{ key: 'total', header: 'Cobrado', align: 'right' },
		{ key: 'commission', header: 'Comisión', align: 'right' }
	];

	/** The balance in words: who it is in favour of. The figure is shown without a sign. */
	const balanceLabel = $derived(
		!ledger || ledger.summary.balance === 0
			? 'Sin saldo'
			: ledger.summary.balance > 0
				? 'Saldo a favor del cobrador'
				: 'Saldo a cargo del cobrador'
	);

	const base = $derived(resolve('/portal/[campaignId]/cuenta', { campaignId: data.campaign.id }));
</script>

<svelte:head>
	<title>Mi cuenta corriente - {data.campaign.name} - {institutionName()}</title>
</svelte:head>

<PageHeader
	title="Mi cuenta corriente"
	description={`Campaña ${data.campaign.name}. Solo lectura.`}
	breadcrumbs={[{ label: 'Mi portal', href: resolve('/portal') }, { label: 'Mi cuenta corriente' }]}
/>

{#if !ledger}
	<EmptyState title="El usuario todavía no está vinculado a un cobrador">
		Pedir a un administrador que vincule el usuario con la ficha de cobrador. Mientras tanto no hay
		datos para mostrar.
	</EmptyState>
{:else}
	<div class="flex flex-col gap-6">
		<!-- The balance and what it means first; the commission figures are reference amounts beside it
		     (they are not the terms of a sum, so they are not drawn as one). -->
		<section
			aria-label="Saldo"
			class="max-w-[520px] rounded-lg border border-border bg-surface px-5 py-4"
		>
			<div data-testid="ledger-balance" class="flex items-baseline justify-between gap-3">
				<p class="m-0 text-body font-semibold">{balanceLabel}</p>
				<p class="m-0 font-figure text-figure-lg whitespace-nowrap tabular-nums">
					{money(Math.abs(ledger.summary.balance))}
				</p>
			</div>
			<p class="m-0 mt-1 text-body-sm text-muted">Suma los movimientos que no están anulados.</p>
			<dl
				data-testid="commission-summary"
				class="m-0 mt-3 grid gap-1 border-t border-border pt-3 text-body-sm text-muted tabular-nums"
			>
				<div class="flex justify-between gap-3">
					<dt>Comisiones generadas</dt>
					<dd class="m-0 whitespace-nowrap">{money(ledger.summary.commissionGenerated)}</dd>
				</div>
				<div class="flex justify-between gap-3">
					<dt>Ajustadas</dt>
					<dd class="m-0 whitespace-nowrap">{money(ledger.summary.commissionAdjusted)}</dd>
				</div>
				<div class="flex justify-between gap-3">
					<dt>Liquidadas</dt>
					<dd class="m-0 whitespace-nowrap">{money(ledger.summary.commissionSettled)}</dd>
				</div>
				<div class="flex justify-between gap-3">
					<dt>Anulaciones y correcciones</dt>
					<dd class="m-0 whitespace-nowrap">
						{money(ledger.summary.commissionAnnulments + ledger.summary.otherMovements)}
					</dd>
				</div>
			</dl>
		</section>

		<Section id="entries" title="Movimientos">
			{#if entryRows.some((r) => r.status === 'annulled')}
				<Alert tone="info">Los movimientos anulados se muestran tachados y no suman al saldo.</Alert
				>
			{/if}
			<Table
				columns={entryColumns}
				rows={entryRows}
				caption="Movimientos de mi cuenta corriente"
				stack
			>
				{#snippet cell({ row, column })}
					{#if column.key === 'credit'}
						<span class="max-[719px]:hidden">{row.credit}</span>
						<span class="min-[720px]:hidden {row.status === 'annulled' ? 'line-through' : ''}"
							>{row.signed}</span
						>
					{:else if column.key === 'type'}
						<span class={row.status === 'annulled' ? 'text-muted line-through' : undefined}
							>{row.type}</span
						>
						{#if row.reason}<p
								class="m-0 text-body-sm text-muted break-words"
								data-testid="adjustment-reason"
							>
								Motivo: {row.reason}
							</p>{/if}
						{#if row.reference}<p class="m-0 text-body-sm text-muted">
								Referencia: no cambia el saldo.
							</p>{/if}
					{:else if column.key === 'status'}
						<StatusBadge kind="ledger" status={row.status} />
					{:else}
						{row[column.key as keyof EntryRow]}
					{/if}
				{/snippet}
				{#snippet empty()}
					<EmptyState title="Todavía no hay movimientos">
						Los movimientos aparecen cuando se generan comisiones, se registran rendiciones o se
						cargan ajustes.
					</EmptyState>
				{/snippet}
			</Table>
			{#if ledger.pageCount > 1}
				<nav class="mt-4 flex items-center justify-between gap-4" aria-label="Paginación">
					<span class="text-body-sm text-muted" data-testid="ledger-page"
						>Página {ledger.page} de {ledger.pageCount} ({ledger.total} movimientos)</span
					>
					<span class="flex gap-4 text-body-sm">
						<!-- eslint-disable svelte/no-navigation-without-resolve -->
						{#if ledger.page > 1}
							<a
								class="rounded-sm text-primary-text underline-offset-2 hover:underline"
								rel="prev"
								href={`${base}?page=${ledger.page - 1}`}>Anterior</a
							>
						{/if}
						{#if ledger.page < ledger.pageCount}
							<a
								class="rounded-sm text-primary-text underline-offset-2 hover:underline"
								rel="next"
								href={`${base}?page=${ledger.page + 1}`}>Siguiente</a
							>
						{/if}
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					</span>
				</nav>
			{/if}
		</Section>

		<Section id="settlements" title="Historial de rendiciones">
			<Table
				columns={settlementColumns}
				rows={settlementRows}
				caption="Historial de mis rendiciones"
				stack
			>
				{#snippet cell({ row, column })}
					{#if column.key === 'status'}
						<StatusBadge kind="settlement" status={row.status as SettlementStatus} />
					{:else}
						{row[column.key as keyof SettlementRow]}
					{/if}
				{/snippet}
				{#snippet empty()}
					<EmptyState title="Todavía no hay rendiciones">
						Las rendiciones aparecen aquí cuando se registran.
					</EmptyState>
				{/snippet}
			</Table>
			{#if ledger.settlementsTotal > ledger.settlements.length}
				<p class="mt-2 text-body-sm text-muted">
					Se muestran las últimas {ledger.settlements.length} de {ledger.settlementsTotal}
					rendiciones.
				</p>
			{/if}
		</Section>
	</div>
{/if}

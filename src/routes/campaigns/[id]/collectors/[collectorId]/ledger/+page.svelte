<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import {
		Alert,
		Button,
		Dialog,
		Disclosure,
		EmptyState,
		Field,
		FormResult,
		Money,
		MoneySheet,
		PageHeader,
		Select,
		StatusBadge,
		Table,
		Textarea,
		TextInput
	} from '$lib/components/ui';
	import type { TableColumn } from '$lib/components/ui';
	import {
		LEDGER_ENTRY_TYPE_LABELS,
		ledgerBalanceLabel,
		ledgerSheet,
		type LedgerDirection,
		type LedgerEntryType,
		type LedgerStatus
	} from '$lib/domain/ledger';
	import { formatDate, formatMoney } from '$lib/format';
	import { institutionName } from '$lib/institution';
	import type { PageProps } from './$types';

	/**
	 * The collector's current account (UX plan PR 15, audit A12). It leads with the balance in words
	 * (whom it favours, never a bare minus sign) as a sheet whose rows add up to it, over the
	 * movements, newest first; the two manual adjustments are collapsed underneath. The three actions
	 * (`adjustCommission`, `adjustLedger`, `annul`) and their fields are the same.
	 */
	let { data, form }: PageProps = $props();
	const money = (n: number) => formatMoney(n, { decimals: 'always' });

	const result = $derived(
		form as {
			form?: string;
			success?: boolean;
			message?: string;
			errors?: Record<string, string[]>;
		} | null
	);
	const errorsFor = (name: string) => (result?.form === name ? (result.errors ?? {}) : {});
	const resultFor = (name: string) =>
		result?.form === name && result.message
			? { success: !!result.success, message: result.message, errors: result.errors }
			: null;

	const COMMISSION_FIELDS = [
		{ name: 'direction', label: 'A favor de', id: 'commission-direction' },
		{ name: 'amount', label: 'Monto', id: 'commission-amount' },
		{ name: 'reason', label: 'Motivo', id: 'commission-reason' }
	];
	const LEDGER_FIELDS = [
		{ name: 'direction', label: 'Tipo de ajuste', id: 'ledger-direction' },
		{ name: 'originalEntryId', label: 'Compensa el movimiento', id: 'ledger-original' },
		{ name: 'amount', label: 'Monto', id: 'ledger-amount' },
		{ name: 'reason', label: 'Motivo', id: 'ledger-reason' }
	];

	// --- The sheet: what the movements add up to ---------------------------------------------------
	const sheet = $derived(
		ledgerSheet(
			data.entries.map((entry) => ({
				entryType: entry.entryType,
				direction: entry.direction as LedgerDirection,
				amount: entry.amount,
				status: entry.status as LedgerStatus,
				affectsBalance: entry.affectsBalance
			}))
		)
	);
	/**
	 * The database's balance is the one that counts. The rows are drawn only when they add up to it;
	 * if they ever did not, the page would show the balance alone rather than a sum that is off.
	 */
	const balanceCents = $derived(Math.round(data.balance * 100));
	const sheetRows = $derived(
		sheet.balanceCents === balanceCents
			? sheet.rows
			: [
					{
						label: ledgerBalanceLabel(balanceCents),
						value: (Math.abs(balanceCents) / 100).toFixed(2),
						kind: 'lead' as const
					}
				]
	);

	// --- The movements, newest first ---------------------------------------------------------------
	const typeLabel = (type: string) => LEDGER_ENTRY_TYPE_LABELS[type as LedgerEntryType] ?? type;
	const byId = $derived(new Map(data.entries.map((entry) => [entry.id, entry])));
	function describe(id: string | null) {
		const entry = id ? byId.get(id) : undefined;
		if (!entry) return null;
		return `${typeLabel(entry.entryType)} del ${formatDate(entry.occurredAt)} (${money(entry.amount)})`;
	}
	const rows = $derived(
		[...data.entries].reverse().map((entry) => ({
			id: entry.id,
			date: formatDate(entry.occurredAt),
			type: typeLabel(entry.entryType),
			settlementId: entry.settlementId,
			paymentId: entry.paymentId,
			/** Signed: what favours the institution is negative. A reference amount has no sign. */
			amount:
				entry.affectsBalance && entry.direction === 'collector_debit'
					? -entry.amount
					: entry.amount,
			balance: entry.runningBalance,
			status: entry.status as LedgerStatus,
			reason: entry.reason,
			annulReason: entry.annulReason,
			reference: !entry.affectsBalance,
			compensates: describe(entry.originalEntryId),
			canAnnul:
				entry.status === 'recorded' &&
				!entry.settlementId &&
				!entry.originalEntryId &&
				!entry.hasCompensations
		}))
	);
	type Row = (typeof rows)[number];
	const columns = $derived<TableColumn<Row>[]>([
		// On a phone the date goes under the movement's name, inside that cell.
		{ key: 'date', header: 'Fecha', stack: 'hidden' },
		{ key: 'type', header: 'Movimiento', stack: 'primary' },
		{ key: 'amount', header: 'Importe', align: 'right', stack: 'trailing' },
		{ key: 'balance', header: 'Saldo', align: 'right' },
		...(data.can.adjustLedger
			? [{ key: 'actions', header: 'Acciones', stack: 'secondary' as const }]
			: [])
	]);
	const link =
		'inline-flex items-center rounded-sm text-primary-text underline underline-offset-2 pointer-coarse:min-h-touch';

	// --- Annulling a manual adjustment: asked in a dialog, with its reason -------------------------
	let annulEntryId = $state<string | null>(null);
	let annulReason = $state('');
	let annulling = $state(false);
	const annulEntry = $derived(rows.find((row) => row.id === annulEntryId) ?? null);
	/** The server rejected the annulment asked in the dialog that is open. */
	let annulRejected = $state(false);
	const annulFailure = $derived(
		annulRejected && result?.form === 'annul' && !result.success ? result : null
	);
	const askAnnul = (id: string) => {
		annulReason = '';
		annulRejected = false;
		annulEntryId = id;
	};

	let adjustingCommission = $state(false);
	let adjustingLedger = $state(false);
	const collectorHref = $derived(
		resolve('/campaigns/[id]/collectors/[collectorId]', {
			id: data.campaign.id,
			collectorId: data.collector.id
		})
	);
	/** A compensation goes the opposite way of its original, so only those entries are offered. */
	let ledgerDirection = $state('collector_credit');
	const compensableForDirection = $derived(
		data.compensable.filter((entry) => entry.direction !== ledgerDirection)
	);
</script>

<svelte:head>
	<title
		>Cuenta corriente - {data.collector.displayName} - {data.campaign.name} - {institutionName()}</title
	>
</svelte:head>

<PageHeader
	title="Cuenta corriente de {data.collector.displayName}"
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: data.campaign.name, href: resolve('/campaigns/[id]', { id: data.campaign.id }) },
		{ label: 'Cobradores', href: resolve('/campaigns/[id]/collectors', { id: data.campaign.id }) },
		{ label: data.collector.displayName, href: collectorHref },
		{ label: 'Cuenta corriente' }
	]}
/>

<div class="flex max-w-[960px] flex-col gap-8">
	{#if result?.form === 'annul' && result.success && result.message}
		<Alert tone="success">{result.message}</Alert>
	{:else if result?.form === 'annul' && result.message && annulEntryId === null}
		<Alert tone="danger">{result.message}</Alert>
	{/if}

	<section aria-label="Saldo" class="flex max-w-[520px] flex-col gap-3">
		<div data-testid="ledger-balance">
			<MoneySheet rows={sheetRows} secondary={sheet.secondary} context="document" />
		</div>
		<p class="m-0 text-body-sm text-muted">
			Suma los movimientos que no están anulados. Un importe con signo menos es a favor de Bomberos.
			{#if sheet.secondary.length > 0}
				El efectivo rendido y las transferencias recibidas se muestran como referencia: no cambian
				el saldo.
			{/if}
		</p>
	</section>

	<section aria-label="Movimientos" id="entries">
		<Table {columns} {rows} caption="Movimientos, del más reciente al más antiguo" stack>
			{#snippet cell({ row, column })}
				{#if column.key === 'type'}
					<span class={row.status === 'annulled' ? 'text-muted line-through' : undefined}
						>{row.type}</span
					>
					{#if row.status !== 'recorded'}
						<span class="ml-1 align-middle"><StatusBadge kind="ledger" status={row.status} /></span>
					{/if}
					<span class="block text-body-sm font-normal text-muted min-[720px]:hidden"
						>{row.date}</span
					>
					{#if row.reference}
						<span class="block text-body-sm font-normal text-muted"
							>Referencia: no cambia el saldo.</span
						>
					{/if}
					{#if row.reason}
						<span class="block max-w-prose text-body-sm font-normal break-words text-muted"
							>Motivo: {row.reason}</span
						>
					{/if}
					{#if row.compensates}
						<span class="block max-w-prose text-body-sm font-normal break-words text-muted"
							>Compensa: {row.compensates}</span
						>
					{/if}
					{#if row.annulReason}
						<span class="block max-w-prose text-body-sm font-normal break-words text-muted"
							>Motivo de la anulación: {row.annulReason}</span
						>
					{/if}
					{#if row.settlementId || row.paymentId}
						<span class="flex flex-wrap gap-x-4 text-body-sm font-normal">
							{#if row.settlementId}
								<a
									class={link}
									href={resolve('/campaigns/[id]/settlements/[settlementId]', {
										id: data.campaign.id,
										settlementId: row.settlementId
									})}>Ver la rendición</a
								>
							{/if}
							{#if row.paymentId}
								<!-- eslint-disable svelte/no-navigation-without-resolve -->
								<a
									class={link}
									href={`${resolve('/campaigns/[id]', { id: data.campaign.id })}/payments/${row.paymentId}/print`}
									>Comprobante</a
								>
								<!-- eslint-enable svelte/no-navigation-without-resolve -->
							{/if}
						</span>
					{/if}
				{:else if column.key === 'amount'}
					<Money
						value={row.amount}
						context="document"
						class={row.status === 'annulled'
							? 'text-muted line-through'
							: row.reference
								? 'text-muted'
								: 'font-medium'}
					/>
				{:else if column.key === 'balance'}
					<Money value={row.balance} context="document" />
				{:else if column.key === 'actions'}
					{#if row.canAnnul}
						<Button size="sm" data-annul={row.id} onclick={() => askAnnul(row.id)}>Anular</Button>
					{/if}
				{:else}
					{row[column.key as keyof Row]}
				{/if}
			{/snippet}
			{#snippet empty()}
				<EmptyState title="Todavía no hay movimientos">
					Los movimientos aparecen cuando se generan comisiones, se registran rendiciones o se
					cargan ajustes.
				</EmptyState>
			{/snippet}
		</Table>
	</section>

	{#if data.can.adjustCommission || data.can.adjustLedger}
		<section aria-labelledby="adjust-title" class="flex flex-col gap-2">
			<h2 id="adjust-title" class="m-0 border-b border-border-strong pb-2 text-heading-3 text-text">
				Ajustes manuales
			</h2>
			{#if data.can.adjustCommission}
				<Disclosure summary="Ajustar una comisión" defaultOpen={result?.form === 'commission'}>
					<form
						method="POST"
						action="?/adjustCommission"
						class="flex flex-col gap-5"
						use:enhance={() => {
							adjustingCommission = true;
							return async ({ update }) => {
								try {
									await update({ reset: result?.form === 'commission' });
								} finally {
									adjustingCommission = false;
								}
							};
						}}
					>
						<p class="m-0 text-body-sm text-muted">
							Se registra como una diferencia y nunca cambia la regla de comisión.
						</p>
						<FormResult result={resultFor('commission')} fields={COMMISSION_FIELDS} />
						<div class="grid gap-5 sm:grid-cols-2">
							<Field
								label="A favor de"
								id="commission-direction"
								error={errorsFor('commission').direction?.[0]}
							>
								<Select
									name="direction"
									options={[
										{ value: 'in_favor_of_collector', label: 'El cobrador' },
										{ value: 'in_favor_of_firefighters', label: 'Bomberos' }
									]}
								/>
							</Field>
							<Field
								label="Monto"
								id="commission-amount"
								error={errorsFor('commission').amount?.[0]}
								required
							>
								<TextInput name="amount" prefix="$" inputmode="decimal" autocomplete="off" />
							</Field>
						</div>
						<Field
							label="Motivo"
							id="commission-reason"
							error={errorsFor('commission').reason?.[0]}
							required
						>
							<TextInput name="reason" maxlength={data.reasonMax} autocomplete="off" />
						</Field>
						<div>
							<Button type="submit" variant="primary" loading={adjustingCommission}
								>Registrar ajuste</Button
							>
						</div>
					</form>
				</Disclosure>
			{/if}

			{#if data.can.adjustLedger}
				<Disclosure summary="Ajustar la cuenta corriente" defaultOpen={result?.form === 'ledger'}>
					<form
						method="POST"
						action="?/adjustLedger"
						class="flex flex-col gap-5"
						use:enhance={() => {
							adjustingLedger = true;
							return async ({ update }) => {
								try {
									await update({ reset: result?.form === 'ledger' });
								} finally {
									adjustingLedger = false;
								}
							};
						}}
					>
						<p class="m-0 text-body-sm text-muted">
							Un crédito suma a favor del cobrador; un débito, a favor de Bomberos. Para corregir un
							movimiento se lo compensa con un ajuste en sentido contrario.
						</p>
						<FormResult result={resultFor('ledger')} fields={LEDGER_FIELDS} />
						<div class="grid gap-5 sm:grid-cols-2">
							<Field
								label="Tipo de ajuste"
								id="ledger-direction"
								error={errorsFor('ledger').direction?.[0]}
							>
								<Select
									name="direction"
									bind:value={ledgerDirection}
									options={[
										{ value: 'collector_credit', label: 'Crédito (a favor del cobrador)' },
										{ value: 'collector_debit', label: 'Débito (a favor de Bomberos)' }
									]}
								/>
							</Field>
							<Field
								label="Compensa el movimiento"
								id="ledger-original"
								optional
								hint="Para corregir un movimiento: el ajuste va en sentido contrario y no supera lo que queda."
								error={errorsFor('ledger').originalEntryId?.[0]}
							>
								<Select
									name="originalEntryId"
									options={[
										{ value: '', label: 'Ninguno' },
										...compensableForDirection.map((entry) => ({
											value: entry.id,
											label: entry.label
										}))
									]}
								/>
							</Field>
							<Field
								label="Monto"
								id="ledger-amount"
								error={errorsFor('ledger').amount?.[0]}
								required
							>
								<TextInput name="amount" prefix="$" inputmode="decimal" autocomplete="off" />
							</Field>
						</div>
						<Field
							label="Motivo"
							id="ledger-reason"
							error={errorsFor('ledger').reason?.[0]}
							required
						>
							<TextInput name="reason" maxlength={data.reasonMax} autocomplete="off" />
						</Field>
						<div>
							<Button type="submit" variant="primary" loading={adjustingLedger}
								>Registrar ajuste</Button
							>
						</div>
					</form>
				</Disclosure>
			{/if}
		</section>
	{/if}
</div>

{#if data.can.adjustLedger}
	<Dialog
		open={annulEntryId !== null}
		onClose={() => (annulEntryId = null)}
		title={annulEntry
			? `¿Anular el movimiento «${annulEntry.type}» del ${annulEntry.date}?`
			: '¿Anular este movimiento?'}
		description={`${
			annulEntry ? `Es de ${money(Math.abs(annulEntry.amount))}. ` : ''
		}El movimiento se conserva como registro, pero deja de contar en el saldo. No se puede deshacer.`}
		confirmLabel="Anular movimiento"
		confirmDisabled={!annulReason.trim()}
		tone="danger"
		loading={annulling}
		action="?/annul"
		enhance={(node) =>
			enhance(node, () => {
				annulling = true;
				return async ({ result: answer, update }) => {
					annulling = false;
					// A rejected annulment stays in its dialog, with the error and what was typed.
					annulRejected = answer.type === 'failure';
					if (!annulRejected) annulEntryId = null;
					await update({ reset: false });
				};
			})}
	>
		<input type="hidden" name="entryId" value={annulEntryId ?? ''} />
		{#if annulFailure?.message && !annulFailure.errors?.reason?.length}
			<Alert tone="danger">{annulFailure.message}</Alert>
		{/if}
		<Field
			label="Motivo de la anulación"
			id="annul-reason"
			required
			error={annulFailure?.errors?.reason?.[0]}
		>
			<Textarea name="reason" rows={3} maxlength={data.reasonMax} bind:value={annulReason} />
		</Field>
	</Dialog>
{/if}

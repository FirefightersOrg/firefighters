<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import {
		Alert,
		Button,
		Dialog,
		EmptyState,
		Field,
		FormResult,
		PageHeader,
		Section,
		Select,
		Stat,
		StatusBadge,
		Table,
		Textarea,
		TextInput
	} from '$lib/components/ui';
	import type { TableColumn } from '$lib/components/ui';
	import {
		LEDGER_ENTRY_TYPE_LABELS_ES,
		type LedgerEntryType,
		type LedgerStatus
	} from '$lib/domain/ledger';
	import { formatDate, formatMoney } from '$lib/format';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const money = (n: number) => formatMoney(n, { decimals: 'always' });

	function source(entry: {
		settlementId: string | null;
		paymentId: string | null;
		entryType: string;
	}) {
		if (entry.settlementId) return 'Rendición';
		if (entry.paymentId) return 'Pago';
		return entry.entryType.startsWith('adjustment') ? 'Ajuste manual' : 'Manual';
	}

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
		{ name: 'amount', label: 'Monto', id: 'ledger-amount' },
		{ name: 'reason', label: 'Motivo', id: 'ledger-reason' }
	];

	const rows = $derived(
		data.entries.map((entry) => ({
			id: entry.id,
			date: formatDate(entry.occurredAt),
			type: LEDGER_ENTRY_TYPE_LABELS_ES[entry.entryType as LedgerEntryType] ?? entry.entryType,
			source: source(entry),
			settlementId: entry.settlementId,
			paymentId: entry.paymentId,
			debit: entry.direction === 'collector_debit' ? money(entry.amount) : '',
			credit: entry.direction === 'collector_credit' ? money(entry.amount) : '',
			balance: money(entry.runningBalance),
			status: entry.status as LedgerStatus,
			reason: entry.reason,
			annulReason: entry.annulReason,
			canAnul: entry.status === 'recorded' && !entry.settlementId
		}))
	);
	type Row = (typeof rows)[number];
	const columns = $derived<TableColumn<Row>[]>([
		{ key: 'date', header: 'Fecha' },
		{ key: 'type', header: 'Tipo' },
		{ key: 'source', header: 'Origen' },
		{ key: 'settlement', header: 'Rendición' },
		{ key: 'payment', header: 'Pago' },
		{ key: 'debit', header: 'Débito', align: 'right' },
		{ key: 'credit', header: 'Crédito', align: 'right' },
		{ key: 'balance', header: 'Saldo', align: 'right' },
		{ key: 'status', header: 'Estado' },
		...(data.can.adjustLedger ? [{ key: 'actions', header: 'Acciones' }] : [])
	]);

	let annulEntryId = $state<string | null>(null);
	let annulling = $state(false);
	let adjustingCommission = $state(false);
	let adjustingLedger = $state(false);
	const collectorHref = $derived(
		resolve('/campaigns/[id]/collectors/[collectorId]', {
			id: data.campaign.id,
			collectorId: data.collector.id
		})
	);
</script>

<svelte:head>
	<title
		>Cuenta corriente - {data.collector.displayName} - {data.campaign.name} - Firefighters</title
	>
</svelte:head>

<PageHeader
	title="Cuenta corriente"
	description="Movimientos del cobrador en esta campaña. El saldo se reconstruye con los movimientos no anulados."
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: data.campaign.name, href: resolve('/campaigns/[id]', { id: data.campaign.id }) },
		{ label: 'Cobradores', href: resolve('/campaigns/[id]/collectors', { id: data.campaign.id }) },
		{ label: data.collector.displayName, href: collectorHref },
		{ label: 'Cuenta corriente' }
	]}
/>

<div class="flex flex-col gap-6">
	<div data-testid="ledger-balance" class="max-w-sm">
		<Stat
			label="Saldo"
			value={money(data.balance)}
			detail={data.balance >= 0 ? 'A favor del cobrador' : 'A cargo del cobrador'}
		/>
	</div>

	{#if result?.form === 'annul' && result.message}
		<Alert tone={result.success ? 'success' : 'danger'}>{result.message}</Alert>
	{/if}

	<Section id="entries" title="Movimientos">
		<Table {columns} {rows} caption="Movimientos de la cuenta corriente">
			{#snippet cell({ row, column })}
				{#if column.key === 'type'}
					<span class={row.status !== 'recorded' ? 'text-muted line-through' : undefined}
						>{row.type}</span
					>
				{:else if column.key === 'settlement'}
					{#if row.settlementId}
						<!-- eslint-disable svelte/no-navigation-without-resolve -->
						<a
							class="rounded-sm text-primary-text underline-offset-2 hover:underline"
							href={`${resolve('/campaigns/[id]', { id: data.campaign.id })}/settlements/${row.settlementId}`}
							>Ver</a
						>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					{:else}—{/if}
				{:else if column.key === 'payment'}
					{#if row.paymentId}
						<!-- eslint-disable svelte/no-navigation-without-resolve -->
						<a
							class="rounded-sm text-primary-text underline-offset-2 hover:underline"
							href={`${resolve('/campaigns/[id]', { id: data.campaign.id })}/payments/${row.paymentId}/print`}
							>Comprobante</a
						>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					{:else}—{/if}
				{:else if column.key === 'status'}
					<StatusBadge kind="ledger" status={row.status} />
					{#if row.reason}<p class="m-0 mt-1 max-w-xs text-body-sm break-words">
							{row.reason}
						</p>{/if}
					{#if row.annulReason}
						<p class="m-0 mt-1 max-w-xs text-body-sm break-words">
							Motivo de la anulación: {row.annulReason}
						</p>
					{/if}
				{:else if column.key === 'actions'}
					{#if row.canAnul}
						<Button
							size="sm"
							variant="ghost"
							data-annul={row.id}
							onclick={() => (annulEntryId = row.id)}>Anular</Button
						>
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
	</Section>

	{#if data.can.adjustCommission}
		<Section id="commission-adjust" title="Ajuste manual de comisión">
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
								{ value: 'in_favor_of_firefighters', label: 'Firefighters' }
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
		</Section>
	{/if}

	{#if data.can.adjustLedger}
		<Section id="ledger-adjust" title="Ajuste de la cuenta corriente">
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
				<FormResult result={resultFor('ledger')} fields={LEDGER_FIELDS} />
				<div class="grid gap-5 sm:grid-cols-2">
					<Field
						label="Tipo de ajuste"
						id="ledger-direction"
						error={errorsFor('ledger').direction?.[0]}
					>
						<Select
							name="direction"
							options={[
								{ value: 'collector_credit', label: 'Crédito (a favor del cobrador)' },
								{ value: 'collector_debit', label: 'Débito (a favor de Firefighters)' }
							]}
						/>
					</Field>
					<Field label="Monto" id="ledger-amount" error={errorsFor('ledger').amount?.[0]} required>
						<TextInput name="amount" prefix="$" inputmode="decimal" autocomplete="off" />
					</Field>
				</div>
				<Field label="Motivo" id="ledger-reason" error={errorsFor('ledger').reason?.[0]} required>
					<TextInput name="reason" maxlength={data.reasonMax} autocomplete="off" />
				</Field>
				<div>
					<Button type="submit" variant="primary" loading={adjustingLedger}>Registrar ajuste</Button
					>
				</div>
			</form>
		</Section>

		<Dialog
			open={annulEntryId !== null}
			onClose={() => (annulEntryId = null)}
			title="¿Anular este movimiento?"
			description="El movimiento se conserva como registro, pero deja de contar en el saldo. No se puede deshacer."
			confirmLabel="Anular movimiento"
			tone="danger"
			loading={annulling}
			action="?/annul"
			enhance={(node) =>
				enhance(node, () => {
					annulling = true;
					return async ({ update }) => {
						try {
							annulEntryId = null;
							await update();
						} finally {
							annulling = false;
						}
					};
				})}
		>
			<input type="hidden" name="entryId" value={annulEntryId ?? ''} />
			<Field label="Motivo de la anulación" id="annul-reason" required>
				<Textarea name="reason" rows={3} maxlength={data.reasonMax} />
			</Field>
		</Dialog>
	{/if}
</div>

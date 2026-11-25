import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { LEDGER_REASON_MAX } from '$lib/domain/ledger';
import { GENERIC_ERROR_MESSAGE } from '$lib/copy';

const uuid = z.guid();
export const commissionSettleSchema = z.object({
	campaignId: uuid,
	collectorId: uuid,
	amount: z.coerce.number().positive().multipleOf(0.01),
	reason: z.string().trim().min(1).max(LEDGER_REASON_MAX)
});
export const collectorLedgerBalanceSchema = z.object({ campaignId: uuid, collectorId: uuid });
export type CommissionSettleInput = z.input<typeof commissionSettleSchema>;

export class CommissionLedgerServiceError extends Error {
	constructor(
		readonly kind: 'permission' | 'validation' | 'not_found' | 'conflict' | 'internal',
		message: string,
		options?: ErrorOptions
	) {
		super(message, options);
		this.name = 'CommissionLedgerServiceError';
	}
	get status() {
		return { permission: 403, validation: 400, not_found: 404, conflict: 409, internal: 500 }[
			this.kind
		];
	}
}

type RpcError = { code?: string; message?: string };

/** Spanish copy for the messages the SQL functions raise (English, internal). */
const DB_MESSAGES: [RegExp, string][] = [
	[
		/closed-settlement entries must be corrected/,
		'Los movimientos de una rendición cerrada se corrigen desde la rendición.'
	],
	[
		/only recorded ledger entries can be annulled/,
		'Solo se pueden anular movimientos registrados.'
	],
	[
		/amount cannot exceed current collector balance/,
		'El monto no puede superar el saldo actual del cobrador.'
	],
	[/amount must be a positive amount/, 'Ingresar un monto positivo con hasta 2 decimales.'],
	[/reason of at most/, 'Ingresar un motivo de hasta 1000 caracteres.'],
	[
		/invalid adjustment direction|invalid ledger direction/,
		'Elegir a favor de quién es el ajuste.'
	],
	[/settlement must be open|settlement has no pending/, 'La rendición no admite esta operación.']
];
function dbMessage(message: string | undefined, fallback: string) {
	return DB_MESSAGES.find(([re]) => re.test(message ?? ''))?.[1] ?? fallback;
}

function mapError(error: RpcError) {
	if (error.code === '42501')
		return new CommissionLedgerServiceError(
			'permission',
			'No hay permiso para acceder a la cuenta corriente del cobrador.'
		);
	if (error.code === 'P0002')
		return new CommissionLedgerServiceError(
			'not_found',
			'No se encontró la campaña, el cobrador o el movimiento.'
		);
	if (['22023', '23514', '22003'].includes(error.code ?? ''))
		return new CommissionLedgerServiceError(
			'validation',
			dbMessage(error.message, 'Los valores ingresados no son válidos. Revisar el formulario.')
		);
	if (error.code === '55000')
		return new CommissionLedgerServiceError(
			'conflict',
			dbMessage(error.message, 'No se puede realizar esta operación en el estado actual.')
		);
	return new CommissionLedgerServiceError('internal', GENERIC_ERROR_MESSAGE, {
		cause: error
	});
}
async function rpc<T>(
	client: SupabaseClient,
	name: string,
	args: Record<string, unknown>
): Promise<T> {
	let result: { data: T | null; error: RpcError | null };
	try {
		result = await client.rpc(name, args);
	} catch (cause) {
		throw new CommissionLedgerServiceError('internal', GENERIC_ERROR_MESSAGE, {
			cause
		});
	}
	if (result.error) throw mapError(result.error);
	return result.data as T;
}

/** Records an audited debit against a positive collector commission balance. */
export async function settleCommission(
	client: SupabaseClient,
	input: CommissionSettleInput,
	ctx: { requestId?: string | null } = {}
): Promise<string> {
	const parsed = commissionSettleSchema.safeParse(input);
	if (!parsed.success)
		throw new CommissionLedgerServiceError(
			'validation',
			'La liquidación de comisión no es válida.',
			{
				cause: parsed.error
			}
		);
	return rpc<string>(client, 'commission_settle', {
		p_campaign_id: parsed.data.campaignId,
		p_collector_id: parsed.data.collectorId,
		p_amount: parsed.data.amount,
		p_reason: parsed.data.reason,
		p_request_id: ctx.requestId ?? null
	});
}

/** Reads the reconstructed, non-annulled collector balance (credit minus debit). */
export async function getCollectorLedgerBalance(
	client: SupabaseClient,
	input: z.input<typeof collectorLedgerBalanceSchema>
): Promise<number> {
	const parsed = collectorLedgerBalanceSchema.safeParse(input);
	if (!parsed.success)
		throw new CommissionLedgerServiceError(
			'validation',
			'La consulta de la cuenta corriente no es válida.',
			{
				cause: parsed.error
			}
		);
	return rpc<number>(client, 'collector_ledger_balance', {
		p_campaign_id: parsed.data.campaignId,
		p_collector_id: parsed.data.collectorId
	});
}

const reason = z.string().trim().min(1).max(LEDGER_REASON_MAX);
const amount = z.coerce.number().positive().multipleOf(0.01);
export const commissionAdjustSchema = z.object({
	campaignId: uuid,
	collectorId: uuid,
	amount,
	direction: z.enum(['in_favor_of_collector', 'in_favor_of_firefighters']),
	reason,
	settlementId: uuid.nullish(),
	paymentId: uuid.nullish()
});
export const ledgerAdjustSchema = z.object({
	campaignId: uuid,
	collectorId: uuid,
	amount,
	direction: z.enum(['collector_credit', 'collector_debit']),
	reason
});
export const ledgerAnnulSchema = z.object({ entryId: uuid, reason });

function parse<S extends z.ZodTypeAny>(schema: S, input: unknown, message: string): z.output<S> {
	const parsed = schema.safeParse(input);
	if (!parsed.success)
		throw new CommissionLedgerServiceError('validation', message, { cause: parsed.error });
	return parsed.data;
}

/** Tier-3 manual commission adjustment: a difference row plus its ledger entry (`commission.adjust`). */
export async function adjustCommission(
	client: SupabaseClient,
	input: z.input<typeof commissionAdjustSchema>,
	ctx: { requestId?: string | null } = {}
): Promise<string> {
	const d = parse(commissionAdjustSchema, input, 'El ajuste de comisión no es válido.');
	return rpc<string>(client, 'commission_adjust', {
		p_campaign_id: d.campaignId,
		p_collector_id: d.collectorId,
		p_amount: d.amount,
		p_direction: d.direction,
		p_reason: d.reason,
		p_settlement_id: d.settlementId ?? null,
		p_payment_id: d.paymentId ?? null,
		p_request_id: ctx.requestId ?? null
	});
}

/** Manual current-account adjustment (`collector.ledger.adjust`). */
export async function adjustCollectorLedger(
	client: SupabaseClient,
	input: z.input<typeof ledgerAdjustSchema>,
	ctx: { requestId?: string | null } = {}
): Promise<string> {
	const d = parse(ledgerAdjustSchema, input, 'El ajuste de la cuenta corriente no es válido.');
	return rpc<string>(client, 'collector_ledger_adjust', {
		p_campaign_id: d.campaignId,
		p_collector_id: d.collectorId,
		p_amount: d.amount,
		p_direction: d.direction,
		p_reason: d.reason,
		p_request_id: ctx.requestId ?? null
	});
}

/** Annuls a recorded entry (`collector.ledger.adjust`); closed-settlement entries are refused. */
export async function annulCollectorLedgerEntry(
	client: SupabaseClient,
	input: z.input<typeof ledgerAnnulSchema>,
	ctx: { requestId?: string | null } = {}
): Promise<void> {
	const d = parse(ledgerAnnulSchema, input, 'La anulación del movimiento no es válida.');
	await rpc<null>(client, 'collector_ledger_annul_entry', {
		p_entry_id: d.entryId,
		p_reason: d.reason,
		p_request_id: ctx.requestId ?? null
	});
}

export interface LedgerEntryView {
	id: string;
	occurredAt: string;
	entryType: string;
	direction: 'collector_credit' | 'collector_debit';
	amount: number;
	status: string;
	settlementId: string | null;
	paymentId: string | null;
	reason: string | null;
	annulReason: string | null;
	runningBalance: number;
}

/** Ledger entries in order with the running balance (annulled entries add 0). */
export async function listCollectorLedger(
	client: SupabaseClient,
	input: z.input<typeof collectorLedgerBalanceSchema>
): Promise<LedgerEntryView[]> {
	const d = parse(
		collectorLedgerBalanceSchema,
		input,
		'La consulta de la cuenta corriente no es válida.'
	);
	const rows = await rpc<Record<string, unknown>[] | null>(
		client,
		'collector_ledger_entries_with_balance',
		{ p_campaign_id: d.campaignId, p_collector_id: d.collectorId }
	);
	return (rows ?? []).map((r) => ({
		id: String(r.id),
		occurredAt: String(r.occurred_at),
		entryType: String(r.entry_type),
		direction: r.direction as LedgerEntryView['direction'],
		amount: Number(r.amount),
		status: String(r.status),
		settlementId: (r.settlement_id as string | null) ?? null,
		paymentId: (r.payment_id as string | null) ?? null,
		reason: (r.reason as string | null) ?? null,
		annulReason: (r.annul_reason as string | null) ?? null,
		runningBalance: Number(r.running_balance)
	}));
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { LEDGER_REASON_MAX } from '$lib/domain/ledger';

const uuid = z.string().uuid();
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
function mapError(error: RpcError) {
	if (error.code === '42501')
		return new CommissionLedgerServiceError(
			'permission',
			'You do not have permission to access the collector ledger.'
		);
	if (error.code === 'P0002')
		return new CommissionLedgerServiceError('not_found', 'The requested collector was not found.');
	if (['22023', '23514', '22003'].includes(error.code ?? ''))
		return new CommissionLedgerServiceError(
			'validation',
			error.message || 'Invalid commission settlement.'
		);
	if (error.code === '55000')
		return new CommissionLedgerServiceError(
			'conflict',
			error.message || 'The commission cannot be settled.'
		);
	return new CommissionLedgerServiceError('internal', 'Something went wrong. Please try again.', {
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
		throw new CommissionLedgerServiceError('internal', 'Something went wrong. Please try again.', {
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
		throw new CommissionLedgerServiceError('validation', 'Invalid commission settlement.', {
			cause: parsed.error
		});
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
		throw new CommissionLedgerServiceError('validation', 'Invalid collector ledger request.', {
			cause: parsed.error
		});
	return rpc<number>(client, 'collector_ledger_balance', {
		p_campaign_id: parsed.data.campaignId,
		p_collector_id: parsed.data.collectorId
	});
}

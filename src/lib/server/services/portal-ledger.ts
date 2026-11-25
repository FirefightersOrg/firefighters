import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { GENERIC_ERROR_MESSAGE } from '$lib/copy';

/** Entries per page of "Mi cuenta corriente"; the SQL function caps a page at 100. */
export const PORTAL_LEDGER_PAGE_SIZE = 25;
export const PORTAL_SETTLEMENTS_PAGE_SIZE = 10;

export class PortalLedgerError extends Error {
	constructor(
		readonly kind: 'permission' | 'not_found' | 'internal',
		message: string,
		options?: ErrorOptions
	) {
		super(message, options);
		this.name = 'PortalLedgerError';
	}
	get status() {
		return { permission: 403, not_found: 404, internal: 500 }[this.kind];
	}
}

function mapError(error: { code?: string }) {
	if (error.code === '42501')
		return new PortalLedgerError('permission', 'No hay permiso para ver tu cuenta corriente.');
	if (error.code === 'P0002')
		return new PortalLedgerError('not_found', 'No se encontró la campaña.');
	return new PortalLedgerError('internal', GENERIC_ERROR_MESSAGE, { cause: error });
}

export interface PortalLedgerSummary {
	balance: number;
	commissionGenerated: number;
	commissionAdjusted: number;
	commissionSettled: number;
	entryCount: number;
}

/** One entry of the collector's own account. No internal notes: only type, amounts and status. */
export interface PortalLedgerEntry {
	id: string;
	occurredAt: string;
	entryType: string;
	direction: 'collector_credit' | 'collector_debit';
	amount: number;
	status: string;
	settlementId: string | null;
	settlementNumber: number | null;
	/** False for reference entries (they are listed but never change the balance). */
	affectsBalance: boolean;
	runningBalance: number;
}

export interface PortalLedgerPage {
	entries: PortalLedgerEntry[];
	total: number;
}

export interface PortalSettlement {
	id: string;
	number: number;
	status: string;
	openedAt: string;
	closedAt: string | null;
	totalAmount: number;
	commissionAmount: number;
	commissionPaidAmount: number;
	netToFirefighters: number;
}

const uuid = z.guid();
const pageSchema = z.object({
	campaignId: uuid,
	page: z.number().int().min(1),
	pageSize: z.number().int().min(1).max(100)
});

/** Page number from `?page=`: a positive integer, otherwise 1. */
export function parsePageParam(value: string | null): number {
	const n = Number(value);
	return Number.isInteger(n) && n >= 1 && n <= 100000 ? n : 1;
}

export async function getPortalLedgerSummary(
	client: SupabaseClient,
	campaignId: string
): Promise<PortalLedgerSummary> {
	if (!uuid.safeParse(campaignId).success)
		throw new PortalLedgerError('not_found', 'No se encontró la campaña.');
	const { data, error } = await client.rpc('portal_my_ledger_summary', {
		p_campaign_id: campaignId
	});
	if (error) throw mapError(error);
	const r = (data as Record<string, unknown>[] | null)?.[0];
	return {
		balance: Number(r?.balance ?? 0),
		commissionGenerated: Number(r?.commission_generated ?? 0),
		commissionAdjusted: Number(r?.commission_adjusted ?? 0),
		commissionSettled: Number(r?.commission_settled ?? 0),
		entryCount: Number(r?.entry_count ?? 0)
	};
}

/** One page of entries, newest first (stable order: the SQL key plus the entry id). */
export async function listPortalLedger(
	client: SupabaseClient,
	input: { campaignId: string; page: number; pageSize?: number }
): Promise<PortalLedgerPage> {
	const parsed = pageSchema.safeParse({ pageSize: PORTAL_LEDGER_PAGE_SIZE, ...input });
	if (!parsed.success) throw new PortalLedgerError('not_found', 'No se encontró la campaña.');
	const { campaignId, page, pageSize } = parsed.data;
	const { data, error } = await client.rpc('portal_my_ledger', {
		p_campaign_id: campaignId,
		p_limit: pageSize,
		p_offset: (page - 1) * pageSize
	});
	if (error) throw mapError(error);
	const rows = (data as Record<string, unknown>[] | null) ?? [];
	return {
		total: rows.length ? Number(rows[0].total_count) : 0,
		entries: rows.map((r) => ({
			id: String(r.id),
			occurredAt: String(r.occurred_at),
			entryType: String(r.entry_type),
			direction: r.direction as PortalLedgerEntry['direction'],
			amount: Number(r.amount),
			status: String(r.status),
			settlementId: (r.settlement_id as string | null) ?? null,
			settlementNumber: r.settlement_number == null ? null : Number(r.settlement_number),
			affectsBalance: r.affects_balance !== false,
			runningBalance: Number(r.running_balance)
		}))
	};
}

const SETTLEMENT_COLUMNS =
	'id, settlement_number, status, opened_at, closed_at, total_amount, commission_amount, commission_paid_amount, net_to_firefighters';

/**
 * Settlement history of the caller. RLS (`settlements_select`) already limits the rows to the own collector;
 * `notes` and the creators are not selected.
 */
export async function listPortalSettlements(
	client: SupabaseClient,
	input: { campaignId: string; limit?: number }
): Promise<{ settlements: PortalSettlement[]; total: number }> {
	const limit = input.limit ?? PORTAL_SETTLEMENTS_PAGE_SIZE;
	const { data, error, count } = await client
		.from('settlements')
		.select(SETTLEMENT_COLUMNS, { count: 'exact' })
		.eq('campaign_id', input.campaignId)
		.order('settlement_number', { ascending: false })
		.order('id', { ascending: false })
		.range(0, limit - 1)
		.overrideTypes<Record<string, unknown>[], { merge: false }>();
	if (error) throw mapError(error);
	return {
		total: count ?? 0,
		settlements: (data ?? []).map((r) => ({
			id: String(r.id),
			number: Number(r.settlement_number),
			status: String(r.status),
			openedAt: String(r.opened_at),
			closedAt: (r.closed_at as string | null) ?? null,
			totalAmount: Number(r.total_amount),
			commissionAmount: Number(r.commission_amount),
			commissionPaidAmount: Number(r.commission_paid_amount),
			netToFirefighters: Number(r.net_to_firefighters)
		}))
	};
}

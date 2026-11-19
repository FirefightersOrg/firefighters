import type { SupabaseClient } from '@supabase/supabase-js';
import { toDecimalString } from '$lib/domain/money';
import type { SettlementStatus } from '$lib/domain/payments';
import type { RepositoryResult } from './campaigns';

type Row = Record<string, unknown>;
const money = (value: unknown) => toDecimalString(value as string | number);
const name = (party: unknown) =>
	(party as { display_name?: string } | null)?.display_name ?? 'Unknown collector';

export type SettlementTotals = {
	totalCash: string;
	totalTransfer: string;
	totalAmount: string;
	commissionAmount: string;
	commissionPaidAmount: string;
	netToFirefighters: string;
	collectorCreditBalance: string;
};
export type SettlementListItem = {
	id: string;
	settlementNumber: number;
	collectorId: string;
	collectorName: string;
	status: SettlementStatus;
	openedAt: string;
	closedAt: string | null;
	totals: SettlementTotals;
};
export type SettlementDetail = {
	id: string;
	settlementNumber: number;
	collectorId: string;
	collectorName: string;
	status: SettlementStatus;
	openedAt: string;
	closedAt: string | null;
	notes: string | null;
	totals: SettlementTotals;
};
const totals = (row: Row): SettlementTotals => ({
	totalCash: money(row.total_cash),
	totalTransfer: money(row.total_transfer),
	totalAmount: money(row.total_amount),
	commissionAmount: money(row.commission_amount),
	commissionPaidAmount: money(row.commission_paid_amount),
	netToFirefighters: money(row.net_to_firefighters),
	collectorCreditBalance: money(row.collector_credit_balance)
});

export async function listSettlements(
	client: SupabaseClient,
	campaignId: string,
	filters: {
		collectorId?: string | null;
		status?: SettlementStatus | null;
		from?: string | null;
		to?: string | null;
	} = {}
): Promise<RepositoryResult<SettlementListItem[]>> {
	let query = client
		.from('settlements')
		.select('*, collectors(display_name)')
		.eq('campaign_id', campaignId);
	if (filters.collectorId) query = query.eq('collector_id', filters.collectorId);
	if (filters.status) query = query.eq('status', filters.status);
	if (filters.from) query = query.gte('opened_at', `${filters.from}T00:00:00`);
	if (filters.to) query = query.lte('opened_at', `${filters.to}T23:59:59.999`);
	const { data, error } = await query
		.order('settlement_number', { ascending: false })
		.overrideTypes<Row[], { merge: false }>();
	if (error) return { data: null, error };
	return {
		data: (data ?? []).map((row) => ({
			id: row.id as string,
			settlementNumber: row.settlement_number as number,
			collectorId: row.collector_id as string,
			collectorName: name(row.collectors),
			status: row.status as SettlementStatus,
			openedAt: row.opened_at as string,
			closedAt: row.closed_at as string | null,
			totals: {
				totalCash: money(row.total_cash),
				totalTransfer: money(row.total_transfer),
				totalAmount: money(row.total_amount),
				commissionAmount: money(row.commission_amount),
				commissionPaidAmount: money(row.commission_paid_amount),
				netToFirefighters: money(row.net_to_firefighters),
				collectorCreditBalance: '0.00'
			}
		})),
		error: null
	};
}
export async function getSettlement(
	client: SupabaseClient,
	campaignId: string,
	id: string
): Promise<RepositoryResult<SettlementDetail>> {
	const { data, error } = await client
		.from('settlements')
		.select('*, collectors(display_name)')
		.eq('campaign_id', campaignId)
		.eq('id', id)
		.maybeSingle()
		.overrideTypes<Row | null, { merge: false }>();
	if (error || !data) return { data: null, error: error ?? new Error('Settlement not found.') };
	const row = data as unknown as Row;
	return {
		data: {
			id: row.id as string,
			settlementNumber: row.settlement_number as number,
			collectorId: row.collector_id as string,
			collectorName: name(row.collectors),
			status: row.status as SettlementStatus,
			openedAt: row.opened_at as string,
			closedAt: row.closed_at as string | null,
			notes: row.notes as string | null,
			// Closed settlements retain their financial snapshot on the settlement row.
			// The totals RPC deliberately only considers pending payments, so it is used
			// exclusively while the settlement remains open.
			totals: {
				totalCash: money(row.total_cash),
				totalTransfer: money(row.total_transfer),
				totalAmount: money(row.total_amount),
				commissionAmount: money(row.commission_amount),
				commissionPaidAmount: money(row.commission_paid_amount),
				netToFirefighters: money(row.net_to_firefighters),
				collectorCreditBalance: '0.00'
			}
		},
		error: null
	};
}
export async function getSettlementTotals(
	client: SupabaseClient,
	id: string
): Promise<RepositoryResult<SettlementTotals>> {
	const { data, error } = await client
		.rpc('settlement_totals', { p_settlement_id: id })
		.overrideTypes<Row[], { merge: false }>();
	return error
		? { data: null, error }
		: { data: totals((data as unknown as Row[] | null)?.[0] ?? {}), error: null };
}
export async function listSettlementPayments(client: SupabaseClient, id: string) {
	const { data, error } = await client
		.from('payments')
		.select('id,amount,payment_method,payment_date,status,sales(bond_id)')
		.eq('settlement_id', id)
		.order('created_at', { ascending: false })
		.overrideTypes<Row[], { merge: false }>();
	return error
		? { data: null, error }
		: {
				data: (data ?? []).map((p) => ({
					id: p.id as string,
					amount: money(p.amount),
					method: p.payment_method as string,
					date: p.payment_date as string,
					status: p.status as string,
					bondId: ((p.sales as Row | null)?.bond_id ?? null) as string | null
				})),
				error: null
			};
}
export async function listBondPayments(client: SupabaseClient, bondId: string) {
	const { data, error } = await client
		.from('payments')
		.select(
			'id,amount,payment_method,payment_date,status,settlement_id,sales!inner(bond_id),settlements(settlement_number)'
		)
		.eq('sales.bond_id', bondId)
		.order('payment_date', { ascending: false })
		.overrideTypes<Row[], { merge: false }>();
	return error
		? { data: null, error }
		: {
				data: (data ?? []).map((p) => ({
					id: p.id as string,
					amount: money(p.amount),
					method: p.payment_method as string,
					date: p.payment_date as string,
					status: p.status as string,
					settlementId: p.settlement_id as string | null,
					settlementNumber: ((p.settlements as Row | null)?.settlement_number ?? null) as
						number | null
				})),
				error: null
			};
}
/** Active sales and their unpaid installments for the settlement quick-entry form. */
export async function listCollectorPaymentCandidates(
	client: SupabaseClient,
	campaignId: string,
	collectorId: string
) {
	const { data, error } = await client
		.from('installments')
		.select(
			'id,installment_number,due_date,amount,status,payment_plans!inner(sales!inner(id,bond_id,buyer_id,collector_id,campaign_id,status,buyers(first_name,last_name,business_name),bonds(bond_numbers(number_value,number_kind))))'
		)
		.eq('payment_plans.sales.campaign_id', campaignId)
		.eq('payment_plans.sales.collector_id', collectorId)
		.eq('payment_plans.sales.status', 'active')
		.in('status', ['pending', 'overdue'])
		.order('due_date')
		.overrideTypes<Row[], { merge: false }>();
	if (error) return { data: null, error };
	return {
		data: (data ?? []).map((row) => {
			const plan = row.payment_plans as Row;
			const sale = plan.sales as Row;
			const buyer = sale.buyers as Row | null;
			const bond = sale.bonds as Row | null;
			const numbers = ((bond?.bond_numbers as Row[] | null) ?? [])
				.filter((n) => n.number_kind === 'base')
				.map((n) => n.number_value)
				.join(', ');
			return {
				id: row.id as string,
				saleId: sale.id as string,
				bond: numbers,
				buyer:
					buyer?.business_name ||
					[buyer?.first_name, buyer?.last_name].filter(Boolean).join(' ') ||
					'Unknown buyer',
				dueDate: row.due_date as string,
				amount: money(row.amount),
				status: row.status as string,
				number: row.installment_number as number
			};
		}),
		error: null
	};
}

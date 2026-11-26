import type { SupabaseClient } from '@supabase/supabase-js';
import { centsToDecimalString, parseMoneyToCents, toDecimalString } from '$lib/domain/money';
import type { SettlementStatus } from '$lib/domain/payments';
import { UNREADABLE_BUYER } from '$lib/domain/settlement-entry';
import type { RepositoryResult } from './campaigns';

type Row = Record<string, unknown>;
// Stay below PostgREST's max-rows and never treat its default 1000-row response as complete.
const PAGE_SIZE = 500;
async function readPages(
	fetchPage: (from: number, to: number) => PromiseLike<RepositoryResult<Row[]>>
): Promise<RepositoryResult<Row[]>> {
	const rows: Row[] = [];
	for (let from = 0; ; from += PAGE_SIZE) {
		const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
		if (error) return { data: null, error };
		rows.push(...(data ?? []));
		if (!data || data.length < PAGE_SIZE) return { data: rows, error: null };
	}
}
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
	if (filters.from) query = query.gte('opened_at', `${filters.from}T00:00:00-03:00`);
	if (filters.to) query = query.lte('opened_at', `${filters.to}T23:59:59.999999-03:00`);
	query = query.order('settlement_number', { ascending: false }).order('id');
	const { data, error } = await readPages((from, to) =>
		query.range(from, to).overrideTypes<Row[], { merge: false }>()
	);
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
/**
 * How many settlements of the campaign are open, under the caller's RLS. A count only (no rows),
 * for the campaign shell's «Rendiciones» entry.
 */
export async function countOpenSettlements(
	client: SupabaseClient,
	campaignId: string
): Promise<RepositoryResult<number>> {
	const { count, error } = await client
		.from('settlements')
		.select('id', { count: 'exact', head: true })
		.eq('campaign_id', campaignId)
		.eq('status', 'open');
	return error ? { data: null, error } : { data: count ?? 0, error: null };
}

export async function getSettlement(
	client: SupabaseClient,
	campaignId: string,
	id: string
): Promise<RepositoryResult<SettlementDetail | null>> {
	const { data, error } = await client
		.from('settlements')
		.select('*, collectors(display_name)')
		.eq('campaign_id', campaignId)
		.eq('id', id)
		.maybeSingle()
		.overrideTypes<Row | null, { merge: false }>();
	if (error || !data) return { data: null, error };
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
const baseNumbers = (bond: Row | null) =>
	((bond?.bond_numbers as Row[] | null) ?? [])
		.filter((n) => n.number_kind === 'base')
		.map((n) => n.number_value)
		.join(', ');
export async function listSettlementPayments(client: SupabaseClient, id: string) {
	const { data, error } = await readPages((from, to) =>
		client
			.from('payments')
			.select(
				'id,amount,payment_method,payment_date,status,buyers(first_name,last_name,business_name),sales(bond_id,bonds(bond_numbers(number_value,number_kind))),payment_installments(installments(installment_number))'
			)
			.eq('settlement_id', id)
			.order('created_at', { ascending: false })
			.order('id')
			.range(from, to)
			.overrideTypes<Row[], { merge: false }>()
	);
	return error
		? { data: null, error }
		: {
				data: (data ?? []).map((p) => {
					const sale = p.sales as Row | null;
					const buyer = p.buyers as Row | null;
					return {
						id: p.id as string,
						amount: money(p.amount),
						method: p.payment_method as string,
						date: p.payment_date as string,
						status: p.status as string,
						bondId: (sale?.bond_id ?? null) as string | null,
						/** The bond's base number(s), so every payment can be told apart (audit A4). */
						bond: baseNumbers(sale?.bonds as Row | null),
						/** Null when the caller's role cannot read the buyer: the row shows the bond alone. */
						buyer:
							(buyer?.business_name as string | null) ||
							[buyer?.first_name, buyer?.last_name].filter(Boolean).join(' ') ||
							null,
						installments: ((p.payment_installments as Row[] | null) ?? [])
							.map((a) => ((a.installments as Row | null)?.installment_number ?? 0) as number)
							.filter(Boolean)
							.sort((a, b) => a - b)
					};
				}),
				error: null
			};
}
export async function listBondPayments(client: SupabaseClient, bondId: string) {
	const { data, error } = await readPages((from, to) =>
		client
			.from('payments')
			.select(
				'id,amount,payment_method,payment_date,status,settlement_id,sales!inner(bond_id),settlements(settlement_number)'
			)
			.eq('sales.bond_id', bondId)
			.order('payment_date', { ascending: false })
			.order('id')
			.range(from, to)
			.overrideTypes<Row[], { merge: false }>()
	);
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
	const { data, error } = await readPages((from, to) =>
		client
			.from('installments')
			.select(
				'id,installment_number,due_date,amount,status,payment_plans!inner(sales!inner(id,bond_id,buyer_id,collector_id,campaign_id,status,buyers(first_name,last_name,business_name),bonds(bond_numbers(number_value,number_kind))))'
			)
			.eq('payment_plans.sales.campaign_id', campaignId)
			.eq('payment_plans.sales.collector_id', collectorId)
			.eq('payment_plans.sales.status', 'active')
			.in('status', ['pending', 'overdue'])
			.order('due_date')
			.order('id')
			.range(from, to)
			.overrideTypes<Row[], { merge: false }>()
	);
	if (error) return { data: null, error };
	// Page applications as a top-level resource too: embedded to-many relations can
	// themselves be truncated. Match the database's balance rule (all non-annulled payments).
	const applications = await readPages((from, to) =>
		client
			.from('payment_installments')
			.select(
				'payment_id,installment_id,amount_applied,payments!inner(status),installments!inner(status,payment_plans!inner(sales!inner(campaign_id,collector_id,status)))'
			)
			.neq('payments.status', 'annulled')
			.eq('installments.payment_plans.sales.campaign_id', campaignId)
			.eq('installments.payment_plans.sales.collector_id', collectorId)
			.eq('installments.payment_plans.sales.status', 'active')
			.in('installments.status', ['pending', 'overdue'])
			.order('payment_id')
			.order('installment_id')
			.range(from, to)
			.overrideTypes<Row[], { merge: false }>()
	);
	if (applications.error) return { data: null, error: applications.error };
	const applied = new Map<string, number>();
	for (const application of applications.data ?? []) {
		const id = application.installment_id as string;
		applied.set(id, (applied.get(id) ?? 0) + parseMoneyToCents(money(application.amount_applied))!);
	}
	return {
		data: (data ?? [])
			.map((row) => {
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
						(buyer?.business_name as string | null) ||
						[buyer?.first_name, buyer?.last_name].filter(Boolean).join(' ') ||
						UNREADABLE_BUYER,
					dueDate: row.due_date as string,
					amount: centsToDecimalString(
						Math.max(
							0,
							parseMoneyToCents(money(row.amount))! - (applied.get(row.id as string) ?? 0)
						)
					),
					status: row.status as string,
					number: row.installment_number as number
				};
			})
			.filter((candidate) => candidate.amount !== '0.00'),
		error: null
	};
}

export type CollectorSubmittedPayment = {
	id: string;
	date: string;
	amount: string;
	method: string;
	note: string | null;
	submittedAt: string;
	bond: string;
	buyer: string;
	installments: number[];
};

/** Drafts the collector registered from the portal (SAN-147) and nobody has included or rejected yet. */
export async function listCollectorSubmittedPayments(
	client: SupabaseClient,
	campaignId: string,
	collectorId: string
) {
	const { data, error } = await readPages((from, to) =>
		client
			.from('payments')
			.select(
				'id,amount,payment_method,payment_date,collector_note,created_at,buyers(first_name,last_name,business_name),sales(bonds(bond_numbers(number_value,number_kind))),payment_installments(installments(installment_number))'
			)
			.eq('campaign_id', campaignId)
			.eq('collector_id', collectorId)
			.eq('status', 'draft')
			.eq('submitted_by_collector', true)
			.order('created_at')
			.order('id')
			.range(from, to)
			.overrideTypes<Row[], { merge: false }>()
	);
	if (error) return { data: null, error };
	return {
		data: (data ?? []).map((p): CollectorSubmittedPayment => {
			const buyer = p.buyers as Row | null;
			const bond = ((p.sales as Row | null)?.bonds ?? null) as Row | null;
			return {
				id: p.id as string,
				date: p.payment_date as string,
				amount: money(p.amount),
				method: p.payment_method as string,
				note: (p.collector_note as string | null) ?? null,
				submittedAt: p.created_at as string,
				bond: ((bond?.bond_numbers as Row[] | null) ?? [])
					.filter((n) => n.number_kind === 'base')
					.map((n) => n.number_value)
					.join(', '),
				buyer:
					(buyer?.business_name as string | null) ||
					[buyer?.first_name, buyer?.last_name].filter(Boolean).join(' ') ||
					'Comprador sin nombre',
				installments: ((p.payment_installments as Row[] | null) ?? [])
					.map((a) => ((a.installments as Row | null)?.installment_number ?? 0) as number)
					.filter(Boolean)
					.sort((a, b) => a - b)
			};
		}),
		error: null
	};
}

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RepositoryResult } from './campaigns';
import type { SettlementPrintSource } from '$lib/server/documents/settlement-delivery-note';
import type { PaymentCertificateSource } from '$lib/server/documents/payment-certificate';

const paymentRows =
	'id,amount::text,payment_method,payment_date,status,created_at,settlement_id,collectors(display_name),profiles!payments_created_by_fkey(full_name),settlements(settlement_number),sales!inner(buyers(first_name,last_name,business_name),bonds!inner(bond_numbers(number_value,number_kind,source_base_number_id))),payment_installments(amount_applied::text,installments(installment_number))';
const buyer = (
	value: { first_name: string; last_name: string; business_name: string | null } | null
) => value?.business_name || [value?.first_name, value?.last_name].filter(Boolean).join(' ') || '—';
const payment = (row: any): PaymentCertificateSource => ({
	id: row.id,
	bond:
		(row.sales?.bonds?.bond_numbers ?? [])
			.filter((n: any) => n.number_kind === 'base')
			.sort((a: any, b: any) => a.number_value - b.number_value)
			.map((n: any) => String(n.number_value))
			.join(', ') || '—',
	buyer: buyer(row.sales?.buyers),
	collector: row.collectors?.display_name ?? '—',
	installments:
		(row.payment_installments ?? [])
			.map(
				(x: any) => `Installment ${x.installments?.installment_number ?? '—'} (${x.amount_applied})`
			)
			.join(', ') || '—',
	amount: row.amount,
	method: row.payment_method === 'cash' ? 'Cash' : 'Transfer',
	paymentDate: `${row.payment_date}T12:00:00Z`,
	createdAt: row.created_at,
	registeredBy: row.profiles?.full_name ?? '—',
	settlementNumber: row.settlements?.settlement_number ?? null
});
export async function getSettlementPrint(
	supabase: SupabaseClient,
	campaignId: string,
	settlementId: string
): Promise<RepositoryResult<SettlementPrintSource | null>> {
	const { data: settlement, error } = await supabase
		.from('settlements')
		.select(
			'settlement_number,status,opened_at,closed_at,notes,collectors(display_name),profiles!settlements_closed_by_fkey(full_name),total_cash::text,total_transfer::text,total_amount::text,commission_amount::text,commission_paid_amount::text,net_to_firefighters::text'
		)
		.eq('id', settlementId)
		.eq('campaign_id', campaignId)
		.maybeSingle()
		.overrideTypes<any, { merge: false }>();
	if (error || !settlement) return { data: null, error };
	const { data: rows, error: paymentsError } = await supabase
		.from('payments')
		.select(paymentRows)
		.eq('settlement_id', settlementId)
		.in('status', settlement.status === 'open' ? ['pending_in_settlement'] : ['confirmed'])
		.overrideTypes<any[], { merge: false }>();
	if (paymentsError) return { data: null, error: paymentsError };
	let totals = {
		cash: settlement.total_cash,
		transfer: settlement.total_transfer,
		amount: settlement.total_amount,
		commission: settlement.commission_amount,
		commissionPaid: settlement.commission_paid_amount,
		net: settlement.net_to_firefighters,
		balance: '0.00'
	};
	if (settlement.status === 'open') {
		const { data, error: totalsError } = await supabase.rpc('settlement_totals', {
			p_settlement_id: settlementId
		});
		if (totalsError) return { data: null, error: totalsError };
		const t = Array.isArray(data) ? data[0] : data;
		totals = {
			cash: String(t.total_cash),
			transfer: String(t.total_transfer),
			amount: String(t.total_amount),
			commission: String(t.commission_amount),
			commissionPaid: String(t.commission_paid_amount),
			net: String(t.net_to_firefighters),
			balance: String(t.collector_credit_balance ?? 0)
		};
	}
	return {
		data: {
			settlementNumber: settlement.settlement_number,
			status: settlement.status,
			openedAt: settlement.opened_at,
			closedAt: settlement.closed_at,
			collector: settlement.collectors?.display_name ?? '—',
			closedBy: settlement.profiles?.full_name ?? null,
			notes: settlement.notes,
			totals,
			payments: (rows ?? []).map((row) => {
				const p = payment(row);
				return {
					bond: p.bond,
					buyer: p.buyer,
					installments: p.installments,
					method: p.method,
					amount: p.amount
				};
			})
		},
		error: null
	};
}
export async function getPaymentCertificate(
	supabase: SupabaseClient,
	campaignId: string,
	paymentId: string
): Promise<RepositoryResult<{ status: string; payment: PaymentCertificateSource } | null>> {
	const { data, error } = await supabase
		.from('payments')
		.select(paymentRows)
		.eq('id', paymentId)
		.eq('campaign_id', campaignId)
		.maybeSingle()
		.overrideTypes<any, { merge: false }>();
	return error
		? { data: null, error }
		: { data: data ? { status: data.status, payment: payment(data) } : null, error: null };
}

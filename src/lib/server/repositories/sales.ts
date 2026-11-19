import type { SupabaseClient } from '@supabase/supabase-js';
import type { Installment, PaymentPlan, Sale } from '$lib/domain/sales';
import { toDecimalString } from '$lib/domain/money';
import type { RepositoryResult } from './campaigns';

interface SaleRow {
	id: string;
	campaign_id: string;
	bond_id: string;
	buyer_id: string;
	collector_id: string;
	sold_at: string;
	payment_mode: Sale['paymentMode'];
	total_amount: string | number;
	status: Sale['status'];
	created_by: string;
	created_at: string;
	updated_at: string;
}
interface PlanRow {
	id: string;
	sale_id: string;
	installment_count: number;
	total_amount: string | number;
	status: PaymentPlan['status'];
	created_at: string;
}
interface InstallmentRow {
	id: string;
	payment_plan_id: string;
	installment_number: number;
	due_date: string;
	amount: string | number;
	status: Installment['status'];
	updated_at: string;
}
export function mapSaleRow(row: SaleRow): Sale {
	return {
		id: row.id,
		campaignId: row.campaign_id,
		bondId: row.bond_id,
		buyerId: row.buyer_id,
		collectorId: row.collector_id,
		soldAt: row.sold_at,
		paymentMode: row.payment_mode,
		totalAmount: toDecimalString(row.total_amount),
		status: row.status,
		createdBy: row.created_by,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}
export function mapInstallmentRow(row: InstallmentRow): Installment {
	return {
		id: row.id,
		paymentPlanId: row.payment_plan_id,
		installmentNumber: row.installment_number,
		dueDate: row.due_date,
		amount: toDecimalString(row.amount),
		status: row.status,
		updatedAt: row.updated_at
	};
}
export async function getActiveSaleForBond(
	supabase: SupabaseClient,
	bondId: string
): Promise<RepositoryResult<{ sale: Sale; plan: PaymentPlan } | null>> {
	const { data, error } = await supabase
		.from('sales')
		.select('*, payment_plans(*)')
		.eq('bond_id', bondId)
		.eq('status', 'active')
		.limit(1)
		.overrideTypes<(SaleRow & { payment_plans: PlanRow[] })[], { merge: false }>();
	if (error) return { data: null, error };
	const sale = data?.[0];
	if (!sale) return { data: null, error: null };
	// A corrected sale may keep annulled plans: only the active one is the sale's plan.
	const plan = sale.payment_plans.find((candidate) => candidate.status === 'active');
	if (!plan) return { data: null, error: new Error('Active sale has no active payment plan') };
	return {
		data: {
			sale: mapSaleRow(sale),
			plan: {
				id: plan.id,
				saleId: plan.sale_id,
				installmentCount: plan.installment_count,
				totalAmount: toDecimalString(plan.total_amount),
				status: plan.status,
				createdAt: plan.created_at
			}
		},
		error: null
	};
}
/** The installments of a sale's active payment plan, by number. */
export async function listInstallmentsForSale(
	supabase: SupabaseClient,
	saleId: string
): Promise<RepositoryResult<Installment[]>> {
	const { data, error } = await supabase
		.from('installments')
		.select('*, payment_plans!inner(sale_id, status)')
		.eq('payment_plans.sale_id', saleId)
		// The installments of the sale's active plan (annulled plans keep theirs as history).
		.eq('payment_plans.status', 'active')
		.order('installment_number')
		.overrideTypes<InstallmentRow[], { merge: false }>();
	return error ? { data: null, error } : { data: (data ?? []).map(mapInstallmentRow), error: null };
}

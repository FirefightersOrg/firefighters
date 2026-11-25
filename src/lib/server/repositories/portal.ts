import type { SupabaseClient } from '@supabase/supabase-js';
import { toDecimalString } from '$lib/domain/money';
import type { InstallmentStatus, PaymentMode, SaleStatus } from '$lib/domain/sales';
import type { PaymentStatus } from '$lib/domain/payments';
import type { BondFinancialStatus } from '$lib/domain/bonds';
import type { RepositoryResult } from './campaigns';

/**
 * Read-only access of the collector portal (SAN-145). Everything goes through the narrow SECURITY DEFINER
 * `portal_my_*` functions (20270113000000): they check `sale.view_own`, return only the caller's own rows and
 * expose buyers as name, phone and address. `buyers` itself is never read from here.
 */

export const PORTAL_PAGE_SIZE = 20;

type Money = string | number;
const money = (value: Money | null): string => toDecimalString(value ?? 0);

export interface PortalPage<T> {
	items: T[];
	total: number;
	page: number;
	pageSize: number;
}

export interface PortalSaleSummary {
	saleId: string;
	campaignId: string;
	campaignName: string;
	numberDigits: number;
	bondNumbers: number[];
	buyerId: string;
	buyerName: string;
	buyerPhone: string | null;
	saleStatus: SaleStatus;
	paymentMode: PaymentMode;
	totalAmount: string;
	/** Applied by confirmed payments. */
	paidAmount: string;
	/** Applied by payments still pending in a settlement. */
	pendingAmount: string;
	balance: string;
	overdueCount: number;
	nextDueDate: string | null;
	financialStatus: BondFinancialStatus | null;
	soldAt: string;
}

export interface PortalSaleDetail extends Omit<
	PortalSaleSummary,
	'overdueCount' | 'nextDueDate' | 'buyerPhone'
> {
	buyerPhone: string | null;
	buyerAddress: string | null;
}

export interface PortalInstallment {
	id: string;
	number: number;
	dueDate: string;
	amount: string;
	status: InstallmentStatus;
	confirmedAmount: string;
	pendingAmount: string;
	balance: string;
}

export interface PortalPayment {
	id: string;
	paymentDate: string;
	amount: string;
	method: 'cash' | 'transfer';
	status: PaymentStatus;
}

export interface PortalBuyer {
	id: string;
	displayName: string;
	phone: string | null;
	address: string | null;
	saleCount: number;
	balance: string;
}

export interface PortalDueInstallment {
	saleId: string;
	campaignName: string;
	numberDigits: number;
	bondNumbers: number[];
	buyerId: string;
	buyerName: string;
	buyerPhone: string | null;
	installmentId: string;
	installmentNumber: number;
	dueDate: string;
	amount: string;
	status: InstallmentStatus;
	pendingAmount: string;
	balance: string;
}

interface SaleRow {
	sale_id: string;
	campaign_id: string;
	campaign_name: string;
	number_digits: number;
	bond_numbers: number[] | null;
	buyer_id: string;
	buyer_name: string;
	buyer_phone: string | null;
	buyer_address?: string | null;
	sale_status: SaleStatus;
	payment_mode: PaymentMode;
	total_amount: Money;
	paid_amount: Money;
	pending_amount: Money;
	balance: Money;
	overdue_count?: number;
	next_due_date?: string | null;
	financial_status: BondFinancialStatus | null;
	sold_at: string;
	total_count?: number | string;
}

function mapSale(row: SaleRow): PortalSaleSummary {
	return {
		saleId: row.sale_id,
		campaignId: row.campaign_id,
		campaignName: row.campaign_name,
		numberDigits: row.number_digits,
		bondNumbers: row.bond_numbers ?? [],
		buyerId: row.buyer_id,
		buyerName: row.buyer_name,
		buyerPhone: row.buyer_phone,
		saleStatus: row.sale_status,
		paymentMode: row.payment_mode,
		totalAmount: money(row.total_amount),
		paidAmount: money(row.paid_amount),
		pendingAmount: money(row.pending_amount),
		balance: money(row.balance),
		overdueCount: row.overdue_count ?? 0,
		nextDueDate: row.next_due_date ?? null,
		financialStatus: row.financial_status,
		soldAt: row.sold_at
	};
}

const offsetOf = (page: number) => (Math.max(1, page) - 1) * PORTAL_PAGE_SIZE;

function paged<T>(
	rows: { total_count?: number | string }[],
	items: T[],
	page: number
): PortalPage<T> {
	return { items, total: Number(rows[0]?.total_count ?? 0), page, pageSize: PORTAL_PAGE_SIZE };
}

export async function listMySales(
	supabase: SupabaseClient,
	page: number
): Promise<RepositoryResult<PortalPage<PortalSaleSummary>>> {
	const { data, error } = await supabase.rpc('portal_my_sales', {
		p_campaign_id: null,
		p_limit: PORTAL_PAGE_SIZE,
		p_offset: offsetOf(page)
	});
	if (error) return { data: null, error };
	const rows = (data ?? []) as SaleRow[];
	return { data: paged(rows, rows.map(mapSale), page), error: null };
}

/** The sale, or `null` when it does not exist or is not the caller's own. */
export async function getMySale(
	supabase: SupabaseClient,
	saleId: string
): Promise<RepositoryResult<PortalSaleDetail | null>> {
	const { data, error } = await supabase.rpc('portal_my_sale', { p_sale_id: saleId });
	if (error) return { data: null, error };
	const row = ((data ?? []) as SaleRow[])[0];
	if (!row) return { data: null, error: null };
	const { overdueCount: _o, nextDueDate: _n, ...rest } = mapSale(row);
	void _o;
	void _n;
	return { data: { ...rest, buyerAddress: row.buyer_address ?? null }, error: null };
}

export async function listMySaleInstallments(
	supabase: SupabaseClient,
	saleId: string
): Promise<RepositoryResult<PortalInstallment[]>> {
	const { data, error } = await supabase.rpc('portal_my_sale_installments', { p_sale_id: saleId });
	if (error) return { data: null, error };
	const rows = (data ?? []) as {
		installment_id: string;
		installment_number: number;
		due_date: string;
		amount: Money;
		status: InstallmentStatus;
		confirmed_amount: Money;
		pending_amount: Money;
		balance: Money;
	}[];
	return {
		data: rows.map((r) => ({
			id: r.installment_id,
			number: r.installment_number,
			dueDate: r.due_date,
			amount: money(r.amount),
			status: r.status,
			confirmedAmount: money(r.confirmed_amount),
			pendingAmount: money(r.pending_amount),
			balance: money(r.balance)
		})),
		error: null
	};
}

export async function listMySalePayments(
	supabase: SupabaseClient,
	saleId: string
): Promise<RepositoryResult<PortalPayment[]>> {
	const { data, error } = await supabase.rpc('portal_my_sale_payments', { p_sale_id: saleId });
	if (error) return { data: null, error };
	const rows = (data ?? []) as {
		payment_id: string;
		payment_date: string;
		amount: Money;
		payment_method: 'cash' | 'transfer';
		status: PaymentStatus;
	}[];
	return {
		data: rows.map((r) => ({
			id: r.payment_id,
			paymentDate: r.payment_date,
			amount: money(r.amount),
			method: r.payment_method,
			status: r.status
		})),
		error: null
	};
}

export async function listMyBuyers(
	supabase: SupabaseClient,
	page: number
): Promise<RepositoryResult<PortalPage<PortalBuyer>>> {
	const { data, error } = await supabase.rpc('portal_my_buyers_page', {
		p_limit: PORTAL_PAGE_SIZE,
		p_offset: offsetOf(page)
	});
	if (error) return { data: null, error };
	const rows = (data ?? []) as {
		buyer_id: string;
		display_name: string;
		phone: string | null;
		address: string | null;
		sale_count: number | string;
		balance: Money;
		total_count: number | string;
	}[];
	return {
		data: paged(
			rows,
			rows.map((r) => ({
				id: r.buyer_id,
				displayName: r.display_name,
				phone: r.phone,
				address: r.address,
				saleCount: Number(r.sale_count),
				balance: money(r.balance)
			})),
			page
		),
		error: null
	};
}

/** One buyer of the own sales with those sales, or `null` for a foreign or unknown buyer. */
export async function getMyBuyer(
	supabase: SupabaseClient,
	buyerId: string
): Promise<
	RepositoryResult<{
		buyer: Omit<PortalBuyer, 'saleCount' | 'balance'>;
		sales: PortalSaleDetail[];
	} | null>
> {
	const { data, error } = await supabase.rpc('portal_my_buyer', { p_buyer_id: buyerId });
	if (error) return { data: null, error };
	const row = (
		(data ?? []) as {
			buyer_id: string;
			display_name: string;
			phone: string | null;
			address: string | null;
		}[]
	)[0];
	if (!row) return { data: null, error: null };
	const ids = await supabase.rpc('portal_my_buyer_sales', { p_buyer_id: buyerId });
	if (ids.error) return { data: null, error: ids.error };
	const sales: PortalSaleDetail[] = [];
	for (const { sale_id } of (ids.data ?? []) as { sale_id: string }[]) {
		const sale = await getMySale(supabase, sale_id);
		if (sale.error) return { data: null, error: sale.error };
		if (sale.data) sales.push(sale.data);
	}
	return {
		data: {
			buyer: {
				id: row.buyer_id,
				displayName: row.display_name,
				phone: row.phone,
				address: row.address
			},
			sales
		},
		error: null
	};
}

/** "Por cobrar": overdue installments and those due within `days` days (Buenos Aires today). */
export async function listMyDueInstallments(
	supabase: SupabaseClient,
	page: number,
	days = 7
): Promise<RepositoryResult<PortalPage<PortalDueInstallment>>> {
	const { data, error } = await supabase.rpc('portal_my_due_installments', {
		p_days: days,
		p_limit: PORTAL_PAGE_SIZE,
		p_offset: offsetOf(page)
	});
	if (error) return { data: null, error };
	const rows = (data ?? []) as {
		sale_id: string;
		campaign_name: string;
		number_digits: number;
		bond_numbers: number[] | null;
		buyer_id: string;
		buyer_name: string;
		buyer_phone: string | null;
		installment_id: string;
		installment_number: number;
		due_date: string;
		amount: Money;
		status: InstallmentStatus;
		pending_amount: Money;
		balance: Money;
		total_count: number | string;
	}[];
	return {
		data: paged(
			rows,
			rows.map((r) => ({
				saleId: r.sale_id,
				campaignName: r.campaign_name,
				numberDigits: r.number_digits,
				bondNumbers: r.bond_numbers ?? [],
				buyerId: r.buyer_id,
				buyerName: r.buyer_name,
				buyerPhone: r.buyer_phone,
				installmentId: r.installment_id,
				installmentNumber: r.installment_number,
				dueDate: r.due_date,
				amount: money(r.amount),
				status: r.status,
				pendingAmount: money(r.pending_amount),
				balance: money(r.balance)
			})),
			page
		),
		error: null
	};
}

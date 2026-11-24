import { beforeEach, describe, expect, it, vi } from 'vitest';
import { load } from './+page.server';
import {
	ADMIN_PERMISSIONS,
	CAMPAIGN_ID,
	campaignRow,
	makeLocals,
	mockSupabase
} from '../test-helpers';

function loadEvent(locals: App.Locals, id = CAMPAIGN_ID) {
	return {
		locals,
		params: { id },
		url: new URL(`http://localhost:5173/campaigns/${id}`)
	} as unknown as Parameters<typeof load>[0];
}

const BOND_ID = 'b0000000-0000-0000-0000-000000000001';

/** Rows the report functions return, by function name. */
const RPC_ROWS: Record<string, unknown[]> = {
	report_bonds_by_status: [
		{
			commercial_status: 'available',
			financial_status: 'unpaid',
			bond_count: 7,
			total_value: '700.00'
		},
		{ commercial_status: 'sold', financial_status: 'unpaid', bond_count: 2, total_value: '200.00' },
		{
			commercial_status: 'delivered_to_collector',
			financial_status: 'unpaid',
			bond_count: 1,
			total_value: '100.00'
		},
		{
			commercial_status: 'annulled',
			financial_status: 'unpaid',
			bond_count: 1,
			total_value: '100.00'
		}
	],
	report_installments: [
		{
			collector_id: 'c1',
			collector_name: 'Ana',
			bucket: 'paid',
			installment_count: 2,
			amount: '100.00'
		},
		{
			collector_id: 'c1',
			collector_name: 'Ana',
			bucket: 'overdue',
			installment_count: 1,
			amount: '50.00'
		},
		{
			collector_id: 'c1',
			collector_name: 'Ana',
			bucket: 'pending',
			installment_count: 1,
			amount: '50.00'
		}
	],
	report_next_draw: [
		{
			draw_id: 'd1',
			draw_name: 'Diciembre',
			draw_type: 'monthly',
			draw_date: '2026-12-20',
			payment_cutoff_at: '2026-12-15T15:00:00+00:00',
			required_installment_number: 2,
			draw_status: 'scheduled',
			at_risk_count: 1
		}
	],
	report_at_risk_bonds: [
		{
			bond_id: BOND_ID,
			bond_kind: 'simple',
			base_number: 7,
			collector_id: 'c1',
			collector_name: 'Ana',
			missing_installments: '1',
			required_installments: 2,
			total_count: '1'
		}
	],
	report_payments_by_date: [
		{ payment_date: '2026-03-01', payment_method: 'cash', payment_count: 2, total: '90.00' },
		{ payment_date: '2026-03-01', payment_method: 'transfer', payment_count: 1, total: '10.00' }
	],
	report_settlements_by_collector: [
		{
			collector_id: 'c1',
			collector_name: 'Ana',
			status: 'closed',
			settlement_count: 1,
			total_cash: '90.00',
			total_transfer: '10.00',
			total_amount: '100.00',
			commission_amount: '10.00',
			commission_paid_amount: '4.00',
			net_to_firefighters: '90.00'
		}
	],
	report_collector_accounts: [
		{
			collector_id: 'c1',
			collector_name: 'Ana',
			entry_count: 2,
			credit_total: '10.00',
			debit_total: '4.00',
			balance: '6.00',
			last_entry_on: '2026-03-31'
		}
	]
};

function supabaseWithReports(failing?: string) {
	const mock = mockSupabase({ query: { data: campaignRow(), error: null } });
	mock.rpc.mockImplementation((fn: string) => {
		if (fn === failing) return Promise.resolve({ data: null, error: { message: 'boom' } });
		return Promise.resolve({ data: RPC_ROWS[fn] ?? [], error: null });
	});
	return mock;
}

const OPERATIONAL = ['campaign.view', 'report.view_operational'];
const FINANCIAL = ['campaign.view', 'report.view_financial'];

describe('/campaigns/[id] dashboard load', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	it('does not call any report function without a report permission', async () => {
		const { supabase, rpc } = supabaseWithReports();
		const data = (await load(loadEvent(makeLocals({ supabase, permissions: ['campaign.view'] }))))!;
		expect(data.dashboard).toEqual({ operational: null, financial: null });
		expect(rpc).not.toHaveBeenCalled();
	});

	it('builds the operational group from the SQL aggregates', async () => {
		const { supabase, rpc } = supabaseWithReports();
		const data = (await load(loadEvent(makeLocals({ supabase, permissions: OPERATIONAL }))))!;
		expect(data.dashboard.financial).toBeNull();
		expect(data.dashboard.operational).toMatchObject({
			bonds: { total: 10, sold: 2, available: 7, delivered: 1, annulled: 1 },
			revenue: {
				expected: '200.00',
				collected: '100.00',
				pending: '100.00',
				overdue: '50.00',
				collectedPercent: 50
			},
			nextDraw: { id: 'd1', name: 'Diciembre', requiredInstallmentNumber: 2, atRiskCount: 1 },
			atRisk: [{ bondId: BOND_ID, baseNumber: 7, missingInstallments: 1, totalCount: 1 }]
		});
		expect(rpc).toHaveBeenCalledWith('report_at_risk_bonds', {
			p_campaign_id: CAMPAIGN_ID,
			p_draw_id: 'd1',
			p_limit: 25,
			p_offset: 0
		});
		const called = rpc.mock.calls.map(([fn]) => fn);
		expect(called).not.toContain('report_payments_by_date');
	});

	it('builds the financial group from the SQL aggregates', async () => {
		const { supabase } = supabaseWithReports();
		const data = (await load(loadEvent(makeLocals({ supabase, permissions: FINANCIAL }))))!;
		expect(data.dashboard.operational).toBeNull();
		expect(data.dashboard.financial).toMatchObject({
			cash: { cash: '90.00', transfer: '10.00', total: '100.00' },
			commissions: { generated: '10.00', settled: '4.00', pending: '6.00', closedSettlements: 1 },
			balances: { net: '6.00', creditors: 1 }
		});
	});

	it('skips the at-risk list when there is no next draw', async () => {
		const { supabase, rpc } = supabaseWithReports();
		rpc.mockImplementation((fn: string) =>
			Promise.resolve({ data: fn === 'report_next_draw' ? [] : (RPC_ROWS[fn] ?? []), error: null })
		);
		const data = (await load(loadEvent(makeLocals({ supabase, permissions: OPERATIONAL }))))!;
		expect(data.dashboard.operational?.nextDraw).toBeNull();
		expect(data.dashboard.operational?.atRisk).toEqual([]);
		expect(rpc.mock.calls.map(([fn]) => fn)).not.toContain('report_at_risk_bonds');
	});

	it.each([
		['report_bonds_by_status', OPERATIONAL],
		['report_installments', OPERATIONAL],
		['report_next_draw', OPERATIONAL],
		['report_at_risk_bonds', OPERATIONAL],
		['report_payments_by_date', FINANCIAL],
		['report_settlements_by_collector', FINANCIAL],
		['report_collector_accounts', FINANCIAL]
	])('returns 500 when %s fails', async (failing, permissions) => {
		const { supabase } = supabaseWithReports(failing);
		await expect(load(loadEvent(makeLocals({ supabase, permissions })))).rejects.toMatchObject({
			status: 500
		});
	});

	it('returns 500 when the permissions could not be loaded', async () => {
		const { supabase } = supabaseWithReports();
		await expect(
			load(loadEvent(makeLocals({ supabase, permissions: null })))
		).rejects.toMatchObject({ status: 500 });
	});

	it('returns 404 (not a dashboard) for a campaign that is not visible', async () => {
		const mock = mockSupabase({ query: { data: null, error: null } });
		await expect(
			load(
				loadEvent(
					makeLocals({
						supabase: mock.supabase,
						permissions: [...ADMIN_PERMISSIONS, 'report.view_operational']
					})
				)
			)
		).rejects.toMatchObject({ status: 404 });
		expect(mock.rpc).not.toHaveBeenCalled();
	});
});

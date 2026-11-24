import { describe, expect, it, vi } from 'vitest';
import { load } from './+page.server';
import { CAMPAIGN_ID, campaignRow, makeLocals, mockSupabase } from '../../test-helpers';

const COLLECTOR_ID = 'c0000000-0000-0000-0000-000000000001';
const VIEWER = ['campaign.view', 'report.view_operational'];

const REPORT_ROWS: Record<string, unknown[]> = {
	report_bonds_by_status: [
		{
			commercial_status: 'sold',
			financial_status: 'overdue',
			bond_count: 2,
			total_value: '200.00'
		},
		{
			commercial_status: 'available',
			financial_status: 'no_payments',
			bond_count: 1,
			total_value: '100.00'
		}
	],
	report_bonds_by_collector: [
		{
			collector_id: COLLECTOR_ID,
			collector_name: 'Ana',
			bond_count: 2,
			delivered_count: 0,
			sold_count: 2,
			returned_count: 0,
			total_value: '200.00',
			sold_value: '200.00'
		}
	],
	report_installments: [
		{
			collector_id: COLLECTOR_ID,
			collector_name: 'Ana',
			bucket: 'overdue',
			installment_count: 1,
			amount: '50.00'
		}
	],
	report_collector_monthly: [
		{
			collector_id: COLLECTOR_ID,
			collector_name: 'Ana',
			assigned_bonds: 0,
			sold_bonds: 2,
			sold_value: '200.00',
			pending_installments: 0,
			pending_amount: '0.00',
			overdue_installments: 1,
			overdue_amount: '50.00',
			payments_count: 1,
			payments_total: '100.00',
			payments_cash: '100.00',
			payments_transfer: '0.00'
		}
	]
};

function setup(
	permissions: string[] | null = VIEWER,
	opts: { campaign?: unknown; failRpc?: string } = {}
) {
	const mock = mockSupabase({
		tables: {
			campaigns: {
				data: opts.campaign === undefined ? campaignRow() : opts.campaign,
				error: null
			},
			collectors: { data: [{ id: COLLECTOR_ID, display_name: 'Ana' }], error: null }
		}
	});
	mock.rpc.mockImplementation(async (name: string) =>
		name === opts.failRpc
			? { data: null, error: { message: 'boom' } }
			: { data: REPORT_ROWS[name] ?? [], error: null }
	);
	return { ...mock, locals: makeLocals({ supabase: mock.supabase, permissions }) };
}

function event(locals: App.Locals, search = '', id = CAMPAIGN_ID) {
	return {
		locals,
		params: { id },
		url: new URL(`http://localhost/campaigns/${id}/reports${search}`)
	} as unknown as Parameters<typeof load>[0];
}

describe('/campaigns/[id]/reports load', () => {
	it('returns the four reports aggregated, scoped to the campaign', async () => {
		const { locals, rpc } = setup();
		const data = (await load(event(locals)))!;
		expect(data.campaign.id).toBe(CAMPAIGN_ID);
		expect(data.bondsByStatus.bondCount).toBe(3);
		expect(data.bondsByStatus.totalValue).toBe('300.00');
		expect(data.bondsByCollector.totals.soldCount).toBe(2);
		expect(data.installments.totals.overdue).toEqual({ count: 1, amount: '50.00' });
		expect(data.monthly.totals.paymentsTotal).toBe('100.00');
		expect(data.collectors).toEqual([{ id: COLLECTOR_ID, displayName: 'Ana' }]);
		expect(rpc).toHaveBeenCalledTimes(4);
		for (const [, args] of rpc.mock.calls) expect(args.p_campaign_id).toBe(CAMPAIGN_ID);
	});

	it('passes the filters to the SQL functions', async () => {
		const { locals, rpc } = setup();
		await load(
			event(
				locals,
				`?collector=${COLLECTOR_ID}&kind=pata&status=sold&financial=overdue&month=2027-02&from=2027-02-01&to=2027-02-28`
			)
		);
		const args = (name: string) => rpc.mock.calls.find(([n]) => n === name)![1];
		expect(args('report_bonds_by_status')).toMatchObject({
			p_collector_id: COLLECTOR_ID,
			p_kind: 'pata',
			p_commercial_status: 'sold',
			p_financial_status: 'overdue'
		});
		expect(args('report_installments')).toMatchObject({ p_from: '2027-02-01', p_to: '2027-02-28' });
		expect(args('report_collector_monthly')).toMatchObject({
			p_month: '2027-02-01',
			p_collector_id: COLLECTOR_ID
		});
	});

	it('is 403 without report.view_operational and 403 without campaign.view', async () => {
		const noReport = setup(['campaign.view', 'report.view_financial']);
		await expect(load(event(noReport.locals))).rejects.toMatchObject({ status: 403 });
		const noCampaign = setup(['report.view_operational']);
		await expect(load(event(noCampaign.locals))).rejects.toMatchObject({ status: 403 });
		expect(noReport.rpc).not.toHaveBeenCalled();
	});

	it('is 500 (not 403) when the permissions could not be loaded', async () => {
		const { locals, rpc } = setup(null);
		await expect(load(event(locals))).rejects.toMatchObject({ status: 500 });
		expect(rpc).not.toHaveBeenCalled();
	});

	it('redirects to login without a session', async () => {
		const mock = setup();
		const locals = makeLocals({ signedIn: false, supabase: mock.supabase });
		await expect(load(event(locals))).rejects.toMatchObject({ status: 303 });
	});

	it('is 404 for a malformed or missing campaign id', async () => {
		const bad = setup();
		await expect(load(event(bad.locals, '', 'not-a-uuid'))).rejects.toMatchObject({ status: 404 });
		const missing = setup(VIEWER, { campaign: null });
		await expect(load(event(missing.locals))).rejects.toMatchObject({ status: 404 });
		expect(missing.rpc).not.toHaveBeenCalled();
	});

	it('is 400 for an invalid filter', async () => {
		const { locals, rpc } = setup();
		await expect(load(event(locals, '?month=2026-99'))).rejects.toMatchObject({ status: 400 });
		await expect(load(event(locals, '?collector=x'))).rejects.toMatchObject({ status: 400 });
		expect(rpc).not.toHaveBeenCalled();
	});

	it('is 500 when a report function fails', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { locals } = setup(VIEWER, { failRpc: 'report_installments' });
		await expect(load(event(locals))).rejects.toMatchObject({ status: 500 });
		spy.mockRestore();
	});
});

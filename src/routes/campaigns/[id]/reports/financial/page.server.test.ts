import { describe, expect, it, vi } from 'vitest';
import { load } from './+page.server';
import { CAMPAIGN_ID, campaignRow, makeLocals, mockSupabase } from '../../../test-helpers';

const COLLECTOR_ID = 'c0000000-0000-0000-0000-000000000001';
const DRAW_ID = 'd0000000-0000-0000-0000-000000000001';
const VIEWER = ['campaign.view', 'report.view_financial'];

const REPORT_ROWS: Record<string, unknown[]> = {
	report_payments_by_date: [
		{ payment_date: '2027-03-01', payment_method: 'cash', payment_count: 2, total: '100.00' },
		{ payment_date: '2027-03-01', payment_method: 'transfer', payment_count: 1, total: '40.00' }
	],
	report_settlements_by_collector: [
		{
			collector_id: COLLECTOR_ID,
			collector_name: 'Ana',
			status: 'closed',
			settlement_count: 1,
			total_cash: '100.00',
			total_transfer: '40.00',
			total_amount: '140.00',
			commission_amount: '14.00',
			commission_paid_amount: '0.00',
			net_to_firefighters: '126.00'
		}
	],
	report_collector_accounts: [
		{
			collector_id: COLLECTOR_ID,
			collector_name: 'Ana',
			entry_count: 2,
			credit_total: '20.00',
			debit_total: '25.00',
			balance: '-5.00',
			last_entry_on: '2027-03-20'
		}
	],
	report_collector_ledger: [
		{
			entry_id: 'e1',
			occurred_on: '2027-03-20',
			occurred_time: '10:00',
			entry_type: 'cash_settled',
			direction: 'collector_debit',
			amount: '25.00',
			status: 'recorded',
			settlement_number: null,
			reason: null,
			running_balance: '-5.00'
		}
	],
	report_draw_rosters: [
		{
			draw_id: DRAW_ID,
			draw_name: 'Final',
			draw_type: 'final',
			draw_date: '2027-05-01',
			draw_status: 'roster_frozen',
			roster_status: 'frozen',
			eligible_count: 3,
			ineligible_count: 1
		}
	],
	report_draw_roster_entries: [
		{
			number_value: 7,
			eligible: true,
			ineligibility_reason: null,
			buyer_name: 'Eva',
			collector_name: 'Ana'
		}
	],
	report_prizes: [
		{
			prize_id: 'p1',
			draw_id: DRAW_ID,
			draw_name: 'Final',
			draw_date: '2027-05-01',
			prize_position: 1,
			prize_name: 'TV',
			prize_status: 'delivered',
			winning_number: 7,
			result_status: 'eligible_winner',
			buyer_name: 'Eva',
			collector_name: 'Ana',
			award_status: 'delivered',
			awarded_on: '2027-05-02',
			delivered_on: '2027-05-03'
		},
		{
			prize_id: 'p2',
			draw_id: DRAW_ID,
			draw_name: 'Final',
			draw_date: '2027-05-01',
			prize_position: 2,
			prize_name: 'Radio',
			prize_status: 'annulled',
			winning_number: null,
			result_status: null,
			buyer_name: null,
			collector_name: null,
			award_status: null,
			awarded_on: null,
			delivered_on: null
		}
	]
};

function setup(
	permissions: string[] | null = VIEWER,
	opts: { campaign?: unknown; failRpc?: string; failCode?: string } = {}
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
			? { data: null, error: { message: 'boom', code: opts.failCode } }
			: { data: REPORT_ROWS[name] ?? [], error: null }
	);
	return { ...mock, locals: makeLocals({ supabase: mock.supabase, permissions }) };
}

function event(locals: App.Locals, search = '', id = CAMPAIGN_ID) {
	return {
		locals,
		params: { id },
		url: new URL(`http://localhost/campaigns/${id}/reports/financial${search}`)
	} as unknown as Parameters<typeof load>[0];
}

describe('/campaigns/[id]/reports/financial load', () => {
	it('returns the financial reports, scoped to the campaign', async () => {
		const { locals, rpc } = setup();
		const data = (await load(event(locals)))!;
		expect(data.campaign.id).toBe(CAMPAIGN_ID);
		expect(data.payments.totals).toEqual({
			cash: '100.00',
			transfer: '40.00',
			total: '140.00',
			count: 3
		});
		expect(data.settlements.totals.totalAmount).toBe('140.00');
		expect(data.accounts.totals.balance).toBe('-5.00');
		expect(data.draws).toHaveLength(1);
		expect(data.prizes.counts).toEqual({ delivered: 1, annulled: 1 });
		expect(data.collectors).toEqual([{ id: COLLECTOR_ID, displayName: 'Ana' }]);
		// No collector or draw chosen: neither the account detail nor the roster entries load.
		expect(data.ledger).toBeNull();
		expect(data.roster).toBeNull();
		expect(data.canExport).toBe(false);
		expect(rpc).toHaveBeenCalledTimes(5);
		for (const [, args] of rpc.mock.calls) expect(args.p_campaign_id).toBe(CAMPAIGN_ID);
	});

	it('loads the account detail and the roster entries when chosen, and passes the filters', async () => {
		const { locals, rpc } = setup([...VIEWER, 'report.export']);
		const data = (await load(
			event(
				locals,
				`?collector=${COLLECTOR_ID}&method=cash&settlement=closed&from=2027-03-01&to=2027-03-31&draw=${DRAW_ID}&eligibility=eligible&prize=delivered`
			)
		))!;
		expect(data.canExport).toBe(true);
		expect(data.ledger).toHaveLength(1);
		expect(data.roster).toHaveLength(1);
		expect(data.selectedDraw?.drawName).toBe('Final');
		const args = (name: string) => rpc.mock.calls.find(([n]) => n === name)![1];
		expect(args('report_payments_by_date')).toMatchObject({
			p_collector_id: COLLECTOR_ID,
			p_method: 'cash',
			p_from: '2027-03-01',
			p_to: '2027-03-31'
		});
		expect(args('report_settlements_by_collector')).toMatchObject({ p_status: 'closed' });
		expect(args('report_collector_ledger')).toMatchObject({ p_collector_id: COLLECTOR_ID });
		expect(args('report_draw_roster_entries')).toMatchObject({
			p_draw_id: DRAW_ID,
			p_eligible: true,
			p_limit: 500
		});
		expect(args('report_prizes')).toMatchObject({ p_draw_id: DRAW_ID, p_status: 'delivered' });
	});

	it('is 403 without report.view_financial and 403 without campaign.view', async () => {
		const noReport = setup(['campaign.view', 'report.view_operational']);
		await expect(load(event(noReport.locals))).rejects.toMatchObject({ status: 403 });
		const noCampaign = setup(['report.view_financial']);
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

	it('is 404 when the draw does not belong to the campaign', async () => {
		const { locals } = setup(VIEWER, { failRpc: 'report_draw_roster_entries', failCode: 'P0002' });
		await expect(load(event(locals, `?draw=${DRAW_ID}`))).rejects.toMatchObject({ status: 404 });
	});

	it('is 400 for an invalid filter', async () => {
		const { locals, rpc } = setup();
		await expect(load(event(locals, '?method=card'))).rejects.toMatchObject({ status: 400 });
		await expect(load(event(locals, '?from=2027-13-01'))).rejects.toMatchObject({ status: 400 });
		await expect(load(event(locals, '?draw=x'))).rejects.toMatchObject({ status: 400 });
		expect(rpc).not.toHaveBeenCalled();
	});

	it('is 500 when a report function fails', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { locals } = setup(VIEWER, { failRpc: 'report_prizes' });
		await expect(load(event(locals))).rejects.toMatchObject({ status: 500 });
		spy.mockRestore();
	});
});

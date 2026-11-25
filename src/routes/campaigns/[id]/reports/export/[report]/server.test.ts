import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server';
import { CAMPAIGN_ID, campaignRow, makeLocals, mockSupabase } from '../../../../test-helpers';

const COLLECTOR_ID = 'c0000000-0000-0000-0000-000000000001';
const DRAW_ID = 'd0000000-0000-0000-0000-000000000001';
const FINANCIAL = ['campaign.view', 'report.export', 'report.view_financial'];
const OPERATIONAL = ['campaign.view', 'report.export', 'report.view_operational'];

const REPORT_ROWS: Record<string, unknown[]> = {
	report_bonds_by_status: [
		{ commercial_status: 'sold', financial_status: 'overdue', bond_count: 2, total_value: '200.00' }
	],
	report_payments_by_date: [
		{ payment_date: '2027-03-01', payment_method: 'cash', payment_count: 2, total: '100.50' }
	],
	report_collector_accounts: [
		{
			collector_id: COLLECTOR_ID,
			collector_name: '=cmd|calc',
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
			settlement_number: 2,
			reason: '@evil',
			running_balance: '-5.00'
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
	]
};

function setup(
	permissions: string[] | null,
	opts: { campaign?: unknown; failRpc?: { code?: string } } = {}
) {
	const mock = mockSupabase({
		tables: {
			campaigns: { data: opts.campaign === undefined ? campaignRow() : opts.campaign, error: null }
		}
	});
	mock.rpc.mockImplementation(async (name: string) =>
		opts.failRpc
			? { data: null, error: { message: 'boom', ...opts.failRpc } }
			: { data: REPORT_ROWS[name] ?? [], error: null }
	);
	return { ...mock, locals: makeLocals({ supabase: mock.supabase, permissions }) };
}

function event(locals: App.Locals, report: string, search = '', id = CAMPAIGN_ID) {
	return {
		locals,
		params: { id, report },
		url: new URL(`http://localhost/campaigns/${id}/reports/export/${report}${search}`)
	} as unknown as Parameters<typeof GET>[0];
}

describe('GET /campaigns/[id]/reports/export/[report]', () => {
	it('exports a financial report as CSV by default, with the BOM and neutralized text', async () => {
		const { locals, rpc } = setup(FINANCIAL);
		const response = await GET(event(locals, 'collector-accounts'));
		expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
		expect(response.headers.get('content-disposition')).toMatch(
			/^attachment; filename="report-collector-accounts-f0000000-\d{4}-\d{2}-\d{2}\.csv"$/
		);
		expect(response.headers.get('cache-control')).toBe('no-store');
		const bytes = new Uint8Array(await response.arrayBuffer());
		expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
		const text = new TextDecoder().decode(bytes);
		expect(text).toContain('Collector,Entries,');
		expect(text).toContain("'=cmd|calc,2,20.00,25.00,-5.00,2027-03-20");
		expect(rpc.mock.calls[0]![1]).toMatchObject({ p_campaign_id: CAMPAIGN_ID });
	});

	it('exports an operational report with only the operational permission', async () => {
		const { locals } = setup(OPERATIONAL);
		const response = await GET(event(locals, 'bonds-by-status'));
		expect(response.status).toBe(200);
		expect(await response.text()).toContain('Vendido,En mora,2,200.00');
	});

	it('exports Excel with amounts as numbers and neutralized text', async () => {
		const { locals } = setup(FINANCIAL);
		const response = await GET(
			event(locals, 'collector-ledger', `?format=xlsx&collector=${COLLECTOR_ID}`)
		);
		expect(response.headers.get('content-type')).toBe(
			'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
		);
		expect(response.headers.get('content-disposition')).toContain('.xlsx"');
		const workbook = new ExcelJS.Workbook();
		await workbook.xlsx.load((await response.arrayBuffer()) as ArrayBuffer);
		const sheet = workbook.worksheets[0]!;
		const header = (sheet.getRow(1).values as unknown[]).slice(1);
		const row = (sheet.getRow(2).values as unknown[]).slice(1);
		expect(header[0]).toBe('Date');
		const at = (h: string) => row[header.indexOf(h)];
		expect(at('Amount')).toBe(25);
		expect(at('Running balance')).toBe(-5);
		expect(at('Settlement')).toBe(2);
		expect(at('Reason')).toBe("'@evil");
	});

	it('forwards the filters of the screen', async () => {
		const { locals, rpc } = setup(FINANCIAL);
		await GET(event(locals, 'payments-by-date', '?method=cash&from=2027-03-01&to=2027-03-31'));
		expect(rpc.mock.calls[0]![1]).toMatchObject({
			p_method: 'cash',
			p_from: '2027-03-01',
			p_to: '2027-03-31'
		});
	});

	it('is 403 without report.export, without the view permission and without campaign.view', async () => {
		const noExport = setup(['campaign.view', 'report.view_financial']);
		await expect(GET(event(noExport.locals, 'payments-by-date'))).rejects.toMatchObject({
			status: 403
		});
		const operatorOnFinancial = setup(OPERATIONAL);
		await expect(GET(event(operatorOnFinancial.locals, 'prizes'))).rejects.toMatchObject({
			status: 403
		});
		const financialOnOperational = setup(FINANCIAL);
		await expect(
			GET(event(financialOnOperational.locals, 'bonds-by-collector'))
		).rejects.toMatchObject({ status: 403 });
		const noCampaign = setup(['report.export', 'report.view_financial']);
		await expect(GET(event(noCampaign.locals, 'prizes'))).rejects.toMatchObject({ status: 403 });
		for (const m of [noExport, operatorOnFinancial, financialOnOperational, noCampaign]) {
			expect(m.rpc).not.toHaveBeenCalled();
		}
	});

	it('is 500 (not 403) when the permissions could not be loaded', async () => {
		const { locals, rpc } = setup(null);
		await expect(GET(event(locals, 'prizes'))).rejects.toMatchObject({ status: 500 });
		expect(rpc).not.toHaveBeenCalled();
	});

	it('redirects to login without a session', async () => {
		const mock = setup(FINANCIAL);
		const locals = makeLocals({ signedIn: false, supabase: mock.supabase });
		await expect(GET(event(locals, 'prizes'))).rejects.toMatchObject({ status: 303 });
	});

	it('is 404 for an unknown report, a malformed id or a missing campaign', async () => {
		const { locals } = setup(FINANCIAL);
		await expect(GET(event(locals, 'nope'))).rejects.toMatchObject({ status: 404 });
		await expect(GET(event(locals, 'prizes', '', 'not-a-uuid'))).rejects.toMatchObject({
			status: 404
		});
		const missing = setup(FINANCIAL, { campaign: null });
		await expect(GET(event(missing.locals, 'prizes'))).rejects.toMatchObject({ status: 404 });
		expect(missing.rpc).not.toHaveBeenCalled();
	});

	it('is 404 when the database reports an unknown draw', async () => {
		const { locals } = setup(FINANCIAL, { failRpc: { code: 'P0002' } });
		await expect(GET(event(locals, 'draw-roster', `?draw=${DRAW_ID}`))).rejects.toMatchObject({
			status: 404
		});
	});

	it('is 400 for a bad filter, a bad format or a missing collector/draw', async () => {
		const { locals, rpc } = setup(FINANCIAL);
		await expect(GET(event(locals, 'payments-by-date', '?method=card'))).rejects.toMatchObject({
			status: 400
		});
		await expect(GET(event(locals, 'payments-by-date', '?format=pdf'))).rejects.toMatchObject({
			status: 400
		});
		await expect(
			GET(event(setup(OPERATIONAL).locals, 'bonds-by-status', '?month=2027-99'))
		).rejects.toMatchObject({
			status: 400
		});
		await expect(GET(event(locals, 'collector-ledger'))).rejects.toMatchObject({ status: 400 });
		await expect(GET(event(locals, 'draw-roster'))).rejects.toMatchObject({ status: 400 });
		expect(rpc).not.toHaveBeenCalled();
	});

	it('is 403 when the database denies the report, 500 on other failures', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const denied = setup(FINANCIAL, { failRpc: { code: '42501' } });
		await expect(GET(event(denied.locals, 'prizes'))).rejects.toMatchObject({ status: 403 });
		const broken = setup(FINANCIAL, { failRpc: {} });
		await expect(GET(event(broken.locals, 'prizes'))).rejects.toMatchObject({ status: 500 });
		spy.mockRestore();
	});
});

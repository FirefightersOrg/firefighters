import { describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';
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
	report_overdue_sales: [
		{
			sale_id: 's1',
			bond_id: 'b1',
			bond_label: '0068',
			collector_id: COLLECTOR_ID,
			collector_name: 'Ana',
			overdue_count: 4,
			overdue_amount: '400.00',
			oldest_due_date: '2027-01-10',
			threshold: 3
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
		expect(rpc).toHaveBeenCalledTimes(5);
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

describe('overdue warning (SAN-142)', () => {
	it('loads the sales with N+ overdue installments, paged, with N and the edit flags', async () => {
		const { locals, rpc } = setup([...VIEWER, 'campaign.update_rules', 'sale.view']);
		const data = (await load(event(locals, `?collector=${COLLECTOR_ID}`)))!;
		expect(data.overdueWarning).toMatchObject({
			threshold: 3,
			canEdit: true,
			canViewSales: true,
			sales: [{ saleId: 's1', bondLabel: '0068', overdueCount: 4, overdueAmount: '400.00' }]
		});
		expect(rpc.mock.calls.find(([n]) => n === 'report_overdue_sales')![1]).toEqual({
			p_campaign_id: CAMPAIGN_ID,
			p_collector_id: COLLECTOR_ID,
			p_limit: 1000,
			p_offset: 0
		});
		const viewer = (await load(event(setup().locals)))!;
		expect(viewer.overdueWarning).toMatchObject({ canEdit: false, canViewSales: false });
	});

	it('is 500 when the overdue report fails', async () => {
		const { locals } = setup(VIEWER, { failRpc: 'report_overdue_sales' });
		await expect(load(event(locals))).rejects.toMatchObject({ status: 500 });
	});

	const act = async (permissions: string[] | null, threshold: string, rpcError: unknown = null) => {
		const { locals, rpc } = setup(permissions);
		rpc.mockResolvedValue({ data: null, error: rpcError });
		const body = new FormData();
		body.set('threshold', threshold);
		const result = await actions.setOverdueThreshold({
			locals,
			params: { id: CAMPAIGN_ID },
			url: new URL(`http://localhost/campaigns/${CAMPAIGN_ID}/reports`),
			request: new Request('http://localhost', { method: 'POST', body })
		} as never);
		return { result, rpc };
	};
	const EDITOR = [...VIEWER, 'campaign.update_rules'];

	it('requires campaign.update_rules before any RPC', async () => {
		expect((await act(null, '2')).result).toMatchObject({ status: 500 });
		const denied = await act(VIEWER, '2');
		expect(denied.result).toMatchObject({ status: 403 });
		expect(denied.rpc).not.toHaveBeenCalled();
	});

	it('validates 1..120 integers, saves, and maps database refusals', async () => {
		for (const bad of ['0', '121', '2.5', 'x', '']) {
			const { result, rpc } = await act(EDITOR, bad);
			expect(result).toMatchObject({ status: 400, data: { threshold: bad } });
			expect(rpc).not.toHaveBeenCalled();
		}
		const ok = await act(EDITOR, ' 2 ');
		expect(ok.result).toEqual({
			form: 'setOverdueThreshold',
			success: true,
			message: 'Aviso actualizado: desde 2 cuotas vencidas.'
		});
		expect(ok.rpc).toHaveBeenCalledWith('campaign_set_overdue_warning_threshold', {
			p_campaign_id: CAMPAIGN_ID,
			p_threshold: 2,
			p_request_id: expect.anything()
		});
		expect((await act(EDITOR, '1')).result).toMatchObject({
			message: 'Aviso actualizado: desde 1 cuota vencida.'
		});
		expect((await act(EDITOR, '4', { code: '55000', message: 'closed' })).result).toMatchObject({
			status: 409,
			data: { message: 'No se puede cambiar el aviso de una campaña cerrada o anulada.' }
		});
		expect((await act(EDITOR, '4', { code: '42501', message: 'no' })).result).toMatchObject({
			status: 403
		});
	});
});

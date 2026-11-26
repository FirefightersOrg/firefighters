import { describe, expect, it } from 'vitest';
import { load } from './+page.server';
import { CAMPAIGN_ID, campaignRow, makeLocals, mockSupabase } from '../../test-helpers';

const COLLECTOR_ID = 'c0000000-0000-0000-0000-000000000001';
const VIEWER = ['campaign.view', 'collector.view'];
const MANAGER = ['campaign.view', 'collector.manage'];

function collectorRow(overrides: Record<string, unknown> = {}) {
	return {
		id: COLLECTOR_ID,
		display_name: 'Ada Collector',
		phone: '555-0100',
		email: 'ada@example.test',
		address: null,
		user_profile_id: null,
		status: 'active',
		created_by: null,
		created_at: '2026-11-18T00:00:00Z',
		updated_at: '2026-11-18T00:00:00Z',
		...overrides
	};
}

function setup(
	permissions = VIEWER,
	campaign: { data: unknown; error: unknown } = { data: campaignRow(), error: null },
	rpc?: { data: unknown; error: unknown }
) {
	const mock = mockSupabase({
		rpc,
		tables: {
			campaigns: campaign,
			collectors: { data: [collectorRow()], error: null, count: 1 },
			// An exact head count per collector (never rows counted in JS: max_rows would cap them).
			bonds: { data: null, error: null, count: 2 }
		}
	});
	return { ...mock, locals: makeLocals({ supabase: mock.supabase, permissions }) };
}

function event(locals: App.Locals, search = '', id = CAMPAIGN_ID) {
	return {
		locals,
		params: { id },
		url: new URL(`http://localhost/campaigns/${id}/collectors${search}`)
	} as unknown as Parameters<typeof load>[0];
}

describe('/campaigns/[id]/collectors load', () => {
	it('requires collector.view or collector.manage', async () => {
		await expect(load(event(makeLocals({ permissions: ['campaign.view'] })))).rejects.toMatchObject(
			{
				status: 403
			}
		);
		const managed = setup(MANAGER);
		expect((await load(event(managed.locals)))?.can.manage).toBe(true);
	});

	it('returns 404 for a malformed or nonexistent campaign', async () => {
		const malformed = setup();
		await expect(load(event(malformed.locals, '', 'nope'))).rejects.toMatchObject({ status: 404 });
		expect(malformed.from).not.toHaveBeenCalled();
		const missing = setup(VIEWER, { data: null, error: null });
		await expect(load(event(missing.locals))).rejects.toMatchObject({ status: 404 });
	});

	it('applies search and status filters and includes assigned-bond counts', async () => {
		const { locals, chains } = setup();
		const data = await load(event(locals, '?q=Ada%20Collector&status=active&page=2'));
		expect(chains.collectors[0].eq).toHaveBeenCalledWith('status', 'active');
		expect(chains.collectors[0].or).toHaveBeenCalledTimes(2);
		expect(chains.collectors[0].range).toHaveBeenCalledWith(25, 49);
		expect(chains.bonds[0].eq).toHaveBeenCalledWith('campaign_id', CAMPAIGN_ID);
		expect(chains.bonds[0].eq).toHaveBeenCalledWith('current_collector_id', COLLECTOR_ID);
		expect(chains.bonds[0].select).toHaveBeenCalledWith('id', { count: 'exact', head: true });
		expect(data?.collectors[0]).toMatchObject({ displayName: 'Ada Collector', assignedBonds: 2 });
		expect(data?.query).toEqual({ q: 'Ada Collector', status: 'active' });
	});

	// UX plan PR 14b: the balance of each collector, for the roles that read the financial reports.
	it('does not read balances without report.view_financial', async () => {
		const { locals, rpc } = setup();
		const data = await load(event(locals));
		expect(rpc).not.toHaveBeenCalled();
		expect(data?.collectors[0].balance).toBeNull();
		expect(data?.can.balances).toBe(false);
	});

	it('reads the balances of the campaign in one call with report.view_financial', async () => {
		const account = (collector_id: string, balance: string) => ({
			collector_id,
			collector_name: 'Ada Collector',
			entry_count: 3,
			credit_total: '2000.00',
			debit_total: '500.00',
			balance,
			last_entry_on: '2026-11-20'
		});
		const financial = [...VIEWER, 'report.view_financial'];
		const { locals, rpc } = setup(financial, undefined, {
			data: [account(COLLECTOR_ID, '-1500.00')],
			error: null
		});
		const data = await load(event(locals));
		expect(rpc).toHaveBeenCalledTimes(1);
		expect(rpc).toHaveBeenCalledWith('report_collector_accounts', {
			p_campaign_id: CAMPAIGN_ID,
			p_collector_id: null
		});
		expect(data?.collectors[0]).toMatchObject({ balance: '-1500.00', assignedBonds: 2 });
		expect(data?.can.balances).toBe(true);

		// A collector without movements has no row in the report: no balance, not an unknown one.
		const other = setup(financial, undefined, {
			data: [account('c0000000-0000-0000-0000-000000000002', '900.00')],
			error: null
		});
		expect((await load(event(other.locals)))?.collectors[0].balance).toBe('0.00');
	});

	it('fails when the balances cannot be read, instead of showing a list without them', async () => {
		const { locals } = setup([...VIEWER, 'report.view_financial'], undefined, {
			data: null,
			error: { message: 'boom' }
		});
		await expect(load(event(locals))).rejects.toMatchObject({ status: 500 });
	});
});

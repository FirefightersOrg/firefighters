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
	campaign: { data: unknown; error: unknown } = { data: campaignRow(), error: null }
) {
	const mock = mockSupabase({
		tables: {
			campaigns: campaign,
			collectors: { data: [collectorRow()], error: null, count: 1 },
			bonds: {
				data: [{ current_collector_id: COLLECTOR_ID }, { current_collector_id: COLLECTOR_ID }],
				error: null
			}
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
		expect(data?.collectors[0]).toMatchObject({ displayName: 'Ada Collector', assignedBonds: 2 });
		expect(data?.query).toEqual({ q: 'Ada Collector', status: 'active' });
	});
});

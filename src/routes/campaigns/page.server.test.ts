import { beforeEach, describe, expect, it, vi } from 'vitest';
import { load as layoutLoad } from './+layout.server';
import { load } from './+page.server';
import type { Campaign } from '$lib/domain/campaigns';
import { campaignRow, makeLocals, mockSupabase } from './test-helpers';

function event(locals: App.Locals, url = 'http://localhost:5173/campaigns') {
	return { locals, url: new URL(url) } as unknown as Parameters<typeof load>[0];
}

describe('/campaigns guard (+layout.server)', () => {
	it('redirects anonymous users to login, preserving path and query', async () => {
		const locals = makeLocals({ signedIn: false });
		await expect(
			layoutLoad(
				event(locals, 'http://localhost:5173/campaigns/new?x=1') as unknown as Parameters<
					typeof layoutLoad
				>[0]
			)
		).rejects.toMatchObject({
			status: 303,
			location: '/login?redirectTo=%2Fcampaigns%2Fnew%3Fx%3D1'
		});
	});

	it('returns 403 without campaign.view', async () => {
		const locals = makeLocals({ permissions: ['bond.view'] });
		await expect(
			layoutLoad(event(locals) as unknown as Parameters<typeof layoutLoad>[0])
		).rejects.toMatchObject({ status: 403, body: { permission: 'campaign.view' } });
	});

	it('lets a campaign viewer through', async () => {
		const locals = makeLocals({ permissions: ['campaign.view'] });
		await expect(
			layoutLoad(event(locals) as unknown as Parameters<typeof layoutLoad>[0])
		).resolves.toEqual({});
	});
});

describe('/campaigns list (+page.server)', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	it('repeats the guard itself (layout and page loads run in parallel)', async () => {
		const { supabase, from } = mockSupabase();
		await expect(load(event(makeLocals({ signedIn: false, supabase })))).rejects.toMatchObject({
			status: 303
		});
		await expect(
			load(event(makeLocals({ permissions: ['bond.view'], supabase })))
		).rejects.toMatchObject({ status: 403 });
		expect(from).not.toHaveBeenCalled();
	});

	it('lists campaigns and shows "New campaign" only with campaign.create', async () => {
		const { supabase } = mockSupabase({
			query: { data: [campaignRow(), campaignRow({ id: 'x', status: 'active' })], error: null }
		});

		const admin = (await load(event(makeLocals({ supabase }))))!;
		expect(admin.campaigns.map((c: Campaign) => c.status)).toEqual(['draft', 'active']);
		expect(admin.campaigns[0].simpleBondValue).toBe('60000.00');
		expect(admin.canCreate).toBe(true);

		const operator = (await load(event(makeLocals({ permissions: ['campaign.view'], supabase }))))!;
		expect(operator.canCreate).toBe(false);
	});

	it('fails with 500 when the query fails', async () => {
		const { supabase } = mockSupabase({ query: { data: null, error: { message: 'boom' } } });
		await expect(load(event(makeLocals({ supabase })))).rejects.toMatchObject({ status: 500 });
		expect(console.error).toHaveBeenCalled();
	});
});

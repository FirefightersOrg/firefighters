/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/auth/own-collector', () => ({ requireOwnCollector: vi.fn() }));
vi.mock('$lib/server/repositories/campaigns', () => ({ listCampaigns: vi.fn() }));

import { load, _portalHome } from './+page.server';
import { requireOwnCollector } from '$lib/server/auth/own-collector';
import { listCampaigns } from '$lib/server/repositories/campaigns';

const collector = { id: 'col', displayName: 'Jorge Medina', status: 'active' };
const campaign = (id: string, status: string) => ({ id, name: `Campaña ${id}`, status });
const event = () =>
	({ locals: { supabase: {}, requestId: 'r' }, url: new URL('http://localhost/portal') }) as never;
const landing = async (campaigns: unknown[]) => {
	vi.mocked(listCampaigns).mockResolvedValue({ data: campaigns, error: null } as never);
	return Promise.resolve(load(event())).then(
		(data) => ({ data: data as any, redirect: null }),
		(thrown) => ({ data: null, redirect: thrown as { status: number; location: string } })
	);
};

describe('/portal landing (decisions P5 and Q4)', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.mocked(requireOwnCollector).mockResolvedValue(collector as never);
	});

	it('with one campaign in course, goes straight to what there is to collect', async () => {
		const { redirect } = await landing([campaign('a', 'active')]);
		expect(redirect).toMatchObject({ status: 303, location: '/portal/a/por-cobrar' });
		expect(_portalHome('a')).toBe('/portal/a/por-cobrar');
	});

	it('never offers a draft, a closed or an annulled campaign', async () => {
		// One active among campaigns that are not workable: it is the only one, so it opens.
		const one = await landing([
			campaign('draft', 'draft'),
			campaign('a', 'active'),
			campaign('closed', 'closed'),
			campaign('annulled', 'annulled')
		]);
		expect(one.redirect).toMatchObject({ location: '/portal/a/por-cobrar' });
		// Only campaigns that are not workable: the empty state, no redirect, none listed.
		const none = await landing([campaign('draft', 'draft'), campaign('closed', 'closed')]);
		expect(none.redirect).toBeNull();
		expect(none.data.campaigns).toEqual([]);
		expect(none.data.collector).toEqual(collector);
	});

	it('a campaign in closing still takes payments: it is listed, and opened when it is the only one', async () => {
		const only = await landing([campaign('c', 'closing')]);
		expect(only.redirect).toMatchObject({ location: '/portal/c/por-cobrar' });
		const both = await landing([campaign('a', 'active'), campaign('c', 'closing')]);
		expect(both.redirect).toBeNull();
		expect(both.data.campaigns.map((c: { id: string }) => c.id)).toEqual(['a', 'c']);
	});

	it('a user without a collector link gets the empty state and reads no campaigns', async () => {
		vi.mocked(requireOwnCollector).mockResolvedValue(null as never);
		const result = (await load(event())) as any;
		expect(result).toEqual({ collector: null, campaigns: [] });
		expect(listCampaigns).not.toHaveBeenCalled();
	});

	it('fails with a 500 in Spanish when the campaigns cannot be read', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.mocked(listCampaigns).mockResolvedValue({ data: null, error: new Error('boom') } as never);
		await expect(load(event())).rejects.toMatchObject({
			status: 500,
			body: { message: 'No se pudieron cargar las campañas. Volver a intentar.' }
		});
	});
});

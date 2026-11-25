import { describe, expect, it } from 'vitest';
import { actions, load } from './+page.server';
import { actions as campaignActions } from '../+page.server';
import { CAMPAIGN_ID, campaignRow, makeLocals, mockSupabase } from '../../test-helpers';

const event = (locals: App.Locals, id = CAMPAIGN_ID) =>
	({
		locals,
		params: { id },
		url: new URL(`http://localhost:5173/campaigns/${id}/configuracion`)
	}) as unknown as Parameters<typeof load>[0];

describe('/campaigns/[id]/configuracion (Datos y reglas)', () => {
	it('shares the audited actions of the campaign page', () => {
		expect(actions).toBe(campaignActions);
	});
	it('is 404 for a malformed or missing campaign', async () => {
		const { supabase } = mockSupabase({ query: { data: null, error: null } });
		await expect(load(event(makeLocals({ supabase }), 'not-a-uuid'))).rejects.toMatchObject({
			status: 404
		});
		await expect(load(event(makeLocals({ supabase })))).rejects.toMatchObject({ status: 404 });
	});
	it('loads the campaign without the dashboard queries', async () => {
		const { supabase, rpc } = mockSupabase({ query: { data: campaignRow(), error: null } });
		const data = (await load(
			event(makeLocals({ supabase, permissions: ['campaign.view', 'report.view_operational'] }))
		))!;
		expect(data.campaign.id).toBe(CAMPAIGN_ID);
		expect(data.dashboard).toEqual({ operational: null, financial: null });
		expect(rpc).not.toHaveBeenCalled();
	});
});

import { describe, expect, it } from 'vitest';
import { actions } from './+page.server';
import {
	CAMPAIGN_ID,
	makeLocals,
	mockSupabase,
	postRequest,
	type ActionFailure
} from '../../../test-helpers';

const COLLECTOR_ID = 'c0000000-0000-0000-0000-000000000001';
const MANAGER = ['campaign.view', 'collector.manage'];
const fields = {
	displayName: 'Ada Collector',
	phone: '',
	email: 'ada@example.test',
	address: '',
	status: 'active',
	userProfileId: ''
};

function run(locals: App.Locals, values = fields, id = CAMPAIGN_ID): Promise<ActionFailure> {
	const url = `http://localhost/campaigns/${id}/collectors`;
	return actions.default({
		locals,
		params: { id },
		url: new URL(url),
		request: postRequest(url, values)
	} as unknown as Parameters<typeof actions.default>[0]) as Promise<ActionFailure>;
}

describe('/campaigns/[id]/collectors/new action', () => {
	it('redirects to the created collector after the RPC succeeds', async () => {
		const mock = mockSupabase({ rpc: { data: COLLECTOR_ID, error: null } });
		await expect(
			run(makeLocals({ supabase: mock.supabase, permissions: MANAGER }))
		).rejects.toMatchObject({
			status: 303,
			location: `/campaigns/${CAMPAIGN_ID}/collectors/${COLLECTOR_ID}`
		});
	});

	it('validates an empty name and invalid email before calling the RPC', async () => {
		const mock = mockSupabase();
		const result = await run(makeLocals({ supabase: mock.supabase, permissions: MANAGER }), {
			...fields,
			displayName: ' ',
			email: 'not-email'
		});
		expect(result.status).toBe(400);
		expect(result.data.errors).toMatchObject({
			displayName: expect.any(Array),
			email: expect.any(Array)
		});
		expect(mock.rpc).not.toHaveBeenCalled();
	});

	it('returns 403 without collector.manage', async () => {
		const mock = mockSupabase();
		await expect(
			run(makeLocals({ supabase: mock.supabase, permissions: ['campaign.view'] }))
		).rejects.toMatchObject({
			status: 403
		});
		expect(mock.rpc).not.toHaveBeenCalled();
	});

	it('maps an already-linked profile to its field conflict', async () => {
		const mock = mockSupabase({
			rpc: { data: null, error: { code: '23505', message: 'duplicate' } }
		});
		const result = await run(makeLocals({ supabase: mock.supabase, permissions: MANAGER }), {
			...fields,
			userProfileId: 'a0000000-0000-4000-8000-000000000001'
		});
		expect(result).toMatchObject({
			status: 409,
			data: { errors: { userProfileId: ['Ese usuario ya está vinculado a otro cobrador.'] } }
		});
	});

	it('returns 404 for an invalid campaign id without calling the RPC', async () => {
		const mock = mockSupabase();
		const result = await run(
			makeLocals({ supabase: mock.supabase, permissions: MANAGER }),
			fields,
			'nope'
		);
		expect(result.status).toBe(404);
		expect(mock.rpc).not.toHaveBeenCalled();
	});
});

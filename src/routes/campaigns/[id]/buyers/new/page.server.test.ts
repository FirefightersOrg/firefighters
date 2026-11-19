import { describe, expect, it } from 'vitest';
import { actions, load } from './+page.server';
import {
	ADMIN_PERMISSIONS,
	CAMPAIGN_ID,
	campaignRow,
	makeLocals,
	mockSupabase,
	postRequest,
	type ActionFailure
} from '../../../test-helpers';

const BUYER_ID = 'b0000000-0000-0000-0000-000000000001';
const PAGE_URL = `http://localhost:5173/campaigns/${CAMPAIGN_ID}/buyers/new`;
const MANAGER = [...ADMIN_PERMISSIONS, 'buyer.manage'];

const fields = (overrides: Record<string, string> = {}) => ({
	type: 'individual',
	firstName: 'Ada',
	lastName: 'Lovelace',
	businessName: 'Must be discarded',
	documentNumber: '123',
	taxId: 'Must be discarded',
	phone: '',
	address: '',
	usualCollectorId: '',
	notes: '',
	...overrides
});

type QueryResult = { data: unknown; error: unknown };

function setup(
	options: {
		campaign?: QueryResult;
		buyers?: QueryResult;
		rpc?: QueryResult;
		permissions?: string[];
	} = {}
) {
	const mock = mockSupabase({
		tables: {
			campaigns: options.campaign ?? { data: campaignRow(), error: null },
			collectors: { data: [], error: null },
			buyers: options.buyers ?? { data: [], error: null }
		},
		rpc: options.rpc ?? { data: BUYER_ID, error: null }
	});
	return {
		...mock,
		locals: makeLocals({ supabase: mock.supabase, permissions: options.permissions ?? MANAGER })
	};
}

function event(locals: App.Locals, form?: Record<string, string>, id = CAMPAIGN_ID) {
	return {
		locals,
		params: { id },
		url: new URL(PAGE_URL),
		request: postRequest(PAGE_URL, form ?? fields())
	} as unknown as Parameters<typeof actions.default>[0];
}

describe('/campaigns/[id]/buyers/new', () => {
	it('requires buyer.manage and returns 404 for an invalid campaign', async () => {
		const { locals, rpc } = setup({ permissions: ADMIN_PERMISSIONS });
		const denied = (await actions.default(event(locals))) as ActionFailure;
		expect(denied.status).toBe(403);
		expect(rpc).not.toHaveBeenCalled();
		const missing = (await actions.default(
			event(setup().locals, fields(), 'nope')
		)) as ActionFailure;
		expect(missing.status).toBe(404);
		expect(missing.data.message).toBe('Campaign not found.');
	});

	it('loads only for managers and creates an individual, discarding business fields', async () => {
		const { locals } = setup();
		await expect(
			load({
				locals: makeLocals({ permissions: ADMIN_PERMISSIONS }),
				params: { id: CAMPAIGN_ID },
				url: new URL(PAGE_URL)
			} as never)
		).rejects.toMatchObject({ status: 403 });
		await expect(actions.default(event(locals))).rejects.toMatchObject({
			status: 303,
			location: `/campaigns/${CAMPAIGN_ID}/buyers/${BUYER_ID}`
		});
	});

	it('validates the type and requires confirmation for duplicates', async () => {
		const duplicate = {
			id: 'b0000000-0000-0000-0000-000000000002',
			type: 'individual',
			first_name: 'Other',
			last_name: 'Buyer',
			business_name: null,
			document_number: '123',
			tax_id: null,
			phone: null,
			address: null,
			usual_collector_id: null,
			notes: null,
			created_by: null,
			created_at: '2026-01-01T00:00:00Z',
			updated_at: '2026-01-01T00:00:00Z'
		};
		const invalid = (await actions.default(
			event(setup().locals, fields({ type: 'nope' }))
		)) as ActionFailure;
		expect(invalid.status).toBe(400);
		const { locals } = setup({ buyers: { data: [duplicate], error: null } });
		const conflict = (await actions.default(event(locals))) as ActionFailure;
		expect(conflict.status).toBe(409);
		await expect(
			actions.default(event(locals, fields({ createAnyway: 'on' })))
		).rejects.toMatchObject({
			status: 303
		});
	});
});

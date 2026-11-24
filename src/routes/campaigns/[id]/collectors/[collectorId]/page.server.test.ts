import { describe, expect, it } from 'vitest';
import { actions, load } from './+page.server';
import {
	CAMPAIGN_ID,
	campaignRow,
	makeLocals,
	mockSupabase,
	postRequest,
	type ActionFailure
} from '../../../test-helpers';

const COLLECTOR_ID = 'c0000000-0000-0000-0000-000000000001';
const VIEWER = ['campaign.view', 'collector.view'];
const MANAGER = ['campaign.view', 'collector.manage'];
const ADMIN = [...MANAGER, 'audit.view'];
const fields = {
	displayName: 'Ada Collector',
	phone: '',
	email: 'ada@example.test',
	address: '',
	status: 'active',
	userProfileId: '',
	updatedAt: '2026-11-18T00:00:00Z'
};

function collectorRow(overrides: Record<string, unknown> = {}) {
	return {
		id: COLLECTOR_ID,
		display_name: 'Ada Collector',
		phone: null,
		email: 'ada@example.test',
		address: null,
		user_profile_id: null,
		status: 'active',
		created_by: null,
		created_at: '2026-11-18T00:00:00Z',
		updated_at: fields.updatedAt,
		...overrides
	};
}

function setup(
	permissions = ADMIN,
	options: {
		collector?: { data: unknown; error: unknown } | { data: unknown; error: unknown }[];
		rpc?: { data: unknown; error: unknown };
		bondList?: { data: unknown; error: unknown; count?: number };
		profiles?: { data: unknown; error: unknown }[];
	} = {}
) {
	const mock = mockSupabase({
		tables: {
			campaigns: { data: campaignRow(), error: null },
			collectors: options.collector
				? options.collector
				: [
						{ data: collectorRow(), error: null },
						{ data: [], error: null }
					],
			bond_list: options.bondList ?? { data: [], error: null, count: 0 },
			buyers: { data: [], error: null, count: 0 },
			profiles: options.profiles ?? { data: [], error: null },
			audit_log: { data: [], error: null }
		},
		rpc: options.rpc
	});
	return { ...mock, locals: makeLocals({ supabase: mock.supabase, permissions }) };
}

function loadEvent(locals: App.Locals, collectorId = COLLECTOR_ID, id = CAMPAIGN_ID) {
	return {
		locals,
		params: { id, collectorId },
		url: new URL(`http://localhost/campaigns/${id}/collectors/${collectorId}`)
	} as unknown as Parameters<typeof load>[0];
}

function update(
	locals: App.Locals,
	values = fields,
	collectorId = COLLECTOR_ID,
	id = CAMPAIGN_ID
): Promise<ActionFailure> {
	const url = `http://localhost/campaigns/${id}/collectors/${collectorId}?/update`;
	return actions.update({
		locals,
		params: { id, collectorId },
		url: new URL(url),
		request: postRequest(url, values)
	} as unknown as Parameters<typeof actions.update>[0]) as Promise<ActionFailure>;
}

describe('/campaigns/[id]/collectors/[collectorId]', () => {
	it('requires collector.view or collector.manage and 404s missing records', async () => {
		await expect(
			load(loadEvent(makeLocals({ permissions: ['campaign.view'] })))
		).rejects.toMatchObject({
			status: 403
		});
		const missing = setup(VIEWER, { collector: { data: null, error: null } });
		await expect(load(loadEvent(missing.locals))).rejects.toMatchObject({ status: 404 });
	});

	it('only queries and returns audit data with audit.view', async () => {
		const hidden = setup(MANAGER);
		const hiddenData = await load(loadEvent(hidden.locals));
		expect(hidden.from).not.toHaveBeenCalledWith('audit_log');
		expect(hiddenData?.audit).toBeNull();
		const allowed = setup();
		const allowedData = await load(loadEvent(allowed.locals));
		expect(allowed.from).toHaveBeenCalledWith('audit_log');
		expect(allowedData?.can.audit).toBe(true);
	});

	it('updates, accepts no-op RPC results, and deactivates a collector', async () => {
		for (const [rpcData, status] of [
			[true, 'active'],
			[false, 'active'],
			[true, 'inactive']
		] as const) {
			const test = setup(MANAGER, { rpc: { data: rpcData, error: null } });
			const result = await update(test.locals, { ...fields, status });
			expect(result).toMatchObject({ success: true, message: 'Cobrador actualizado.' });
			expect(test.rpc).toHaveBeenCalledWith(
				'collector_update',
				expect.objectContaining({ p_id: COLLECTOR_ID, p_status: status })
			);
		}
	});

	it('maps PT409 to a 409 conflict', async () => {
		const test = setup(MANAGER, {
			rpc: { data: null, error: { code: 'PT409', message: 'stale row' } }
		});
		const result = await update(test.locals);
		expect(result).toMatchObject({
			status: 409,
			data: { message: expect.stringContaining('Otra persona') }
		});
	});

	it('lists assigned bonds by number with the exact total', async () => {
		const row = {
			id: 'b0000000-0000-0000-0000-000000000001',
			campaign_id: CAMPAIGN_ID,
			kind: 'simple',
			origin: 'printed',
			internal_code: null,
			barcode: null,
			commercial_status: 'delivered_to_collector',
			financial_status_snapshot: 'no_payments',
			commercial_unit_count: 1,
			total_value: '60000.00',
			created_at: '2026-11-18T00:00:00Z',
			base_numbers: [68],
			associated_numbers: [4939],
			sort_number: 68,
			group_pata_id: null
		};
		const test = setup(VIEWER, { bondList: { data: [row], error: null, count: 1500 } });
		const data = await load(loadEvent(test.locals));
		expect(data?.bonds.map((b: { baseNumbers: number[] }) => b.baseNumbers)).toEqual([[68]]);
		// More than PostgREST's max_rows: the total comes from the count, not from the rows.
		expect(data?.bondsTotal).toBe(1500);
	});

	it('names the linked user when the profile can be read, else a generic label', async () => {
		const linked = 'a0000000-0000-0000-0000-0000000000aa';
		const test = setup(ADMIN, {
			collector: [
				{ data: collectorRow({ user_profile_id: linked }), error: null },
				{ data: [], error: null }
			],
			profiles: [
				{ data: [], error: null },
				{ data: { full_name: 'Ada Lovelace', email: 'ada@example.test' }, error: null }
			]
		});
		expect((await load(loadEvent(test.locals)))?.profiles[0]).toMatchObject({
			id: linked,
			fullName: 'Ada Lovelace'
		});
		const hidden = setup(VIEWER, {
			collector: [
				{ data: collectorRow({ user_profile_id: linked }), error: null },
				{ data: [], error: null }
			],
			profiles: [
				{ data: [], error: null },
				{ data: null, error: null }
			]
		});
		expect((await load(loadEvent(hidden.locals)))?.profiles[0].fullName).toBe(
			'Usuario vinculado actual'
		);
	});

	it('rejects a malformed updatedAt with 400 before calling the RPC', async () => {
		for (const updatedAt of ['', 'yesterday']) {
			const test = setup(MANAGER);
			const result = await update(test.locals, { ...fields, updatedAt });
			expect(result.status).toBe(400);
			expect(test.rpc).not.toHaveBeenCalled();
		}
	});

	it('returns 404 for malformed action ids without calling the RPC', async () => {
		for (const [id, collectorId] of [
			['nope', COLLECTOR_ID],
			[CAMPAIGN_ID, 'nope']
		]) {
			const test = setup(MANAGER);
			const result = await update(test.locals, fields, collectorId, id);
			expect(result.status).toBe(404);
			expect(test.rpc).not.toHaveBeenCalled();
		}
	});
});

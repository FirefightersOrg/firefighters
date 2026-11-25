import { describe, expect, it, vi } from 'vitest';
import { isHttpError } from '@sveltejs/kit';
import { load } from './+page.server';
import {
	CAMPAIGN_ID,
	campaignRow,
	makeLocals,
	mockSupabase
} from '../../../campaigns/test-helpers';

const COLLECTOR = {
	id: 'c0000000-0000-0000-0000-000000000001',
	display_name: 'Ada',
	status: 'active'
};
const PERMISSIONS = ['campaign.view', 'bond.view_own', 'collector.ledger.view_own'];
const entry = {
	id: 'e0000000-0000-4000-8000-000000000001',
	occurred_at: '2026-11-19T10:00:00Z',
	entry_type: 'commission_generated',
	direction: 'collector_credit',
	amount: '15.00',
	status: 'recorded',
	settlement_id: null,
	settlement_number: null,
	running_balance: '15.00',
	total_count: 60
};
const summary = {
	balance: '15.00',
	commission_generated: '15.00',
	commission_adjusted: '0',
	commission_settled: '0',
	commission_annulments: '0',
	other_movements: '0',
	entry_count: 60
};

function setup(
	options: {
		permissions?: string[] | null;
		collector?: unknown;
		campaign?: unknown;
		rpcError?: { code: string };
	} = {}
) {
	const mock = mockSupabase({
		tables: {
			campaigns: {
				data: options.campaign === undefined ? campaignRow() : options.campaign,
				error: null
			},
			settlements: { data: [], error: null, count: 0 }
		}
	});
	mock.rpc.mockImplementation(async (name: string) => {
		if (options.rpcError && name !== 'portal_my_collector')
			return { data: null, error: options.rpcError };
		if (name === 'portal_my_collector')
			return {
				data: options.collector === undefined ? [COLLECTOR] : options.collector,
				error: null
			};
		if (name === 'portal_my_ledger_summary') return { data: [summary], error: null };
		return { data: [entry], error: null };
	});
	return {
		...mock,
		locals: makeLocals({
			supabase: mock.supabase,
			permissions: options.permissions === undefined ? PERMISSIONS : options.permissions
		})
	};
}

function event(locals: App.Locals, path = `/portal/${CAMPAIGN_ID}/cuenta`, id = CAMPAIGN_ID) {
	return {
		locals,
		params: { campaignId: id },
		url: new URL(`http://localhost${path}`)
	} as unknown as Parameters<typeof load>[0];
}

async function status(fn: () => unknown) {
	try {
		await fn();
		return 200;
	} catch (err) {
		if (isHttpError(err)) return err.status;
		throw err;
	}
}

describe('/portal/[campaignId]/cuenta load', () => {
	it('answers 500 when permissions failed to load and 403 without the own-scope permission', async () => {
		expect(await status(() => load(event(setup({ permissions: null }).locals)))).toBe(500);
		expect(
			await status(() =>
				load(event(setup({ permissions: ['campaign.view', 'bond.view_own'] }).locals))
			)
		).toBe(403);
	});

	it('404s an invalid or unknown campaign', async () => {
		expect(await status(() => load(event(setup().locals, '/portal/x/cuenta', 'x')))).toBe(404);
		expect(await status(() => load(event(setup({ campaign: null }).locals)))).toBe(404);
	});

	it('resolves the collector from the session: the SQL calls carry no collector id', async () => {
		const { locals, rpc } = setup();
		const result = (await load(event(locals, `/portal/${CAMPAIGN_ID}/cuenta?page=2`)))!;
		expect(result.ledger).toMatchObject({ page: 2, pageCount: 3, total: 60 });
		expect(result.ledger?.summary.balance).toBe(15);
		expect(rpc).toHaveBeenCalledWith('portal_my_ledger', {
			p_campaign_id: CAMPAIGN_ID,
			p_limit: 25,
			p_offset: 25
		});
		expect(rpc).toHaveBeenCalledWith('portal_my_ledger_summary', { p_campaign_id: CAMPAIGN_ID });
		for (const [, args] of rpc.mock.calls)
			expect(Object.keys((args ?? {}) as object)).not.toContain('p_collector_id');
	});

	it('falls back to page 1 for a bad page and 404s a page past the end', async () => {
		const { locals } = setup();
		const first = (await load(event(locals, `/portal/${CAMPAIGN_ID}/cuenta?page=abc`)))!;
		expect(first.ledger?.page).toBe(1);
		expect(await status(() => load(event(locals, `/portal/${CAMPAIGN_ID}/cuenta?page=9`)))).toBe(
			404
		);
	});

	it('returns an empty state payload for a profile without a collector', async () => {
		const result = (await load(event(setup({ collector: [] }).locals)))!;
		expect(result.collector).toBeNull();
		expect(result.ledger).toBeNull();
	});

	it('maps SQL failures: permission to 403, unknown to 500', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(await status(() => load(event(setup({ rpcError: { code: '42501' } }).locals)))).toBe(
			403
		);
		expect(await status(() => load(event(setup({ rpcError: { code: 'XX000' } }).locals)))).toBe(
			500
		);
	});
});

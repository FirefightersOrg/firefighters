import { describe, expect, it } from 'vitest';
import { actions, load } from './+page.server';
import {
	CAMPAIGN_ID,
	campaignRow,
	makeLocals,
	mockSupabase,
	postRequest,
	type ActionFailure
} from '../../../../test-helpers';

const COLLECTOR_ID = 'c0000000-0000-0000-0000-000000000001';
const ENTRY_ID = 'e0000000-0000-4000-8000-000000000001';
const VIEW = ['campaign.view', 'collector.ledger.view'];
const ADJUST = ['campaign.view', 'collector.ledger.adjust', 'commission.adjust'];

const collectorRow = {
	id: COLLECTOR_ID,
	display_name: 'Ada Collector',
	phone: null,
	email: null,
	address: null,
	user_profile_id: null,
	status: 'active',
	created_by: null,
	created_at: '2026-11-18T00:00:00Z',
	updated_at: '2026-11-18T00:00:00Z'
};
const ledgerRows = [
	{
		id: ENTRY_ID,
		occurred_at: '2026-11-19T10:00:00Z',
		entry_type: 'commission_generated',
		direction: 'collector_credit',
		amount: '15.00',
		status: 'recorded',
		settlement_id: null,
		payment_id: null,
		reason: null,
		running_balance: '15.00'
	}
];

function setup(
	permissions: string[] = ADJUST,
	rpc: { data: unknown; error: unknown } = { data: ledgerRows, error: null }
) {
	const mock = mockSupabase({
		tables: {
			campaigns: { data: campaignRow(), error: null },
			collectors: { data: collectorRow, error: null }
		},
		rpc
	});
	return { ...mock, locals: makeLocals({ supabase: mock.supabase, permissions }) };
}

const params = { id: CAMPAIGN_ID, collectorId: COLLECTOR_ID };
const base = `http://localhost/campaigns/${CAMPAIGN_ID}/collectors/${COLLECTOR_ID}/ledger`;

function loadEvent(locals: App.Locals, p: Record<string, string> = params) {
	return { locals, params: p, url: new URL(base) } as unknown as Parameters<typeof load>[0];
}

function act(
	name: 'adjustCommission' | 'adjustLedger' | 'annul',
	locals: App.Locals,
	values: Record<string, string>
): Promise<ActionFailure> {
	const url = `${base}?/${name}`;
	return actions[name]({
		locals,
		params,
		url: new URL(url),
		request: postRequest(url, values)
	} as never) as Promise<ActionFailure>;
}

describe('/campaigns/[id]/collectors/[collectorId]/ledger load', () => {
	it('requires collector.ledger.view or collector.ledger.adjust', async () => {
		await expect(
			load(loadEvent(makeLocals({ permissions: ['campaign.view'] })))
		).rejects.toMatchObject({ status: 403 });
		await expect(load(loadEvent(setup(VIEW).locals))).resolves.toBeTruthy();
		await expect(
			load(loadEvent(setup(['campaign.view', 'collector.ledger.adjust']).locals))
		).resolves.toBeTruthy();
	});

	it('404s invalid ids and returns entries with the reconstructed balance', async () => {
		await expect(
			load(loadEvent(setup(VIEW).locals, { id: CAMPAIGN_ID, collectorId: 'bad' }))
		).rejects.toMatchObject({ status: 404 });
		const { locals, rpc } = setup(VIEW);
		const data = await load(loadEvent(locals));
		expect(rpc).toHaveBeenCalledWith('collector_ledger_entries_with_balance', {
			p_campaign_id: CAMPAIGN_ID,
			p_collector_id: COLLECTOR_ID
		});
		expect(data?.entries).toHaveLength(1);
		expect(data?.balance).toBe(15);
		expect(data?.can).toEqual({ adjustCommission: false, adjustLedger: false });
	});

	it('returns annulled adjustments with both reasons and excludes their amount from the balance', async () => {
		const { locals } = setup(VIEW, {
			data: [
				{
					...ledgerRows[0],
					entry_type: 'adjustment_in_favor_of_collector',
					status: 'annulled',
					reason: 'Missed commission',
					annul_reason: 'Entered twice',
					running_balance: '0.00'
				}
			],
			error: null
		});
		const data = await load(loadEvent(locals));
		expect(data?.entries[0]).toMatchObject({
			status: 'annulled',
			reason: 'Missed commission',
			annulReason: 'Entered twice'
		});
		expect(data?.balance).toBe(0);
	});

	it('maps a database permission refusal to 403 and other errors to 500', async () => {
		await expect(
			load(loadEvent(setup(VIEW, { data: null, error: { code: '42501' } }).locals))
		).rejects.toMatchObject({ status: 403 });
		await expect(
			load(loadEvent(setup(VIEW, { data: null, error: { code: 'XX000' } }).locals))
		).rejects.toMatchObject({ status: 500 });
	});
});

describe('/campaigns/[id]/collectors/[collectorId]/ledger actions', () => {
	const adjustment = { amount: '12.50', reason: 'Missed commission' };

	it('denies each action without its permission', async () => {
		const viewer = setup(VIEW).locals;
		expect(
			(await act('adjustCommission', viewer, { ...adjustment, direction: 'in_favor_of_collector' }))
				.status
		).toBe(403);
		expect(
			(await act('adjustLedger', viewer, { ...adjustment, direction: 'collector_credit' })).status
		).toBe(403);
		expect((await act('annul', viewer, { entryId: ENTRY_ID, reason: 'x' })).status).toBe(403);
	});

	it('validates amount, reason and direction before calling the database', async () => {
		const { locals, rpc } = setup();
		const bad = await act('adjustCommission', locals, {
			amount: '1.234',
			reason: ' ',
			direction: 'sideways'
		});
		expect(bad.status).toBe(400);
		expect(Object.keys(bad.data.errors ?? {}).sort()).toEqual(['amount', 'direction', 'reason']);
		const long = await act('adjustLedger', locals, {
			amount: '1',
			reason: 'x'.repeat(1001),
			direction: 'collector_debit'
		});
		expect(long.status).toBe(400);
		expect((await act('annul', locals, { entryId: 'nope', reason: 'x' })).status).toBe(400);
		expect(rpc).not.toHaveBeenCalled();
	});

	it('records commission and ledger adjustments and annulments', async () => {
		const { locals, rpc } = setup(ADJUST, { data: 'new-id', error: null });
		expect(
			await act('adjustCommission', locals, {
				...adjustment,
				direction: 'in_favor_of_firefighters'
			})
		).toMatchObject({ form: 'commission', success: true });
		expect(rpc).toHaveBeenLastCalledWith(
			'commission_adjust',
			expect.objectContaining({ p_direction: 'in_favor_of_firefighters', p_amount: 12.5 })
		);
		expect(
			await act('adjustLedger', locals, { ...adjustment, direction: 'collector_debit' })
		).toMatchObject({ form: 'ledger', success: true });
		expect(rpc).toHaveBeenLastCalledWith(
			'collector_ledger_adjust',
			expect.objectContaining({ p_direction: 'collector_debit' })
		);
		expect(await act('annul', locals, { entryId: ENTRY_ID, reason: 'Twice' })).toMatchObject({
			form: 'annul',
			success: true
		});
	});

	it('maps service errors to their status', async () => {
		const { locals } = setup(ADJUST, {
			data: null,
			error: { code: '55000', message: 'closed-settlement entries must be corrected' }
		});
		const result = await act('annul', locals, { entryId: ENTRY_ID, reason: 'x' });
		expect(result.status).toBe(409);
		expect(result.data.message).toContain('rendición cerrada');
	});
});

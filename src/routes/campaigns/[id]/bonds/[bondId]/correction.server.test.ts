import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';
import {
	ADMIN_PERMISSIONS,
	CAMPAIGN_ID,
	campaignRow,
	makeLocals,
	mockSupabase,
	postRequest,
	profile
} from '../../../test-helpers';

vi.mock('$lib/server/services/sale-corrections', async (original) => ({
	...(await original<typeof import('$lib/server/services/sale-corrections')>()),
	correctBondCollector: vi.fn()
}));
import {
	SaleCorrectionServiceError,
	correctBondCollector
} from '$lib/server/services/sale-corrections';

/** SAN-73: "correct collector" on the bond record (unsold → bond.assign, sold → sale.correct). */

const BOND_ID = 'b0000000-0000-0000-0000-000000000001';
const TARGET = 'c0000000-0000-0000-0000-000000000002';
const BASE = [
	...ADMIN_PERMISSIONS.filter((p) => !p.startsWith('bond.') && p !== 'sale.correct'),
	'bond.view'
];

function bondRow(status: string) {
	return {
		id: BOND_ID,
		campaign_id: CAMPAIGN_ID,
		kind: 'simple',
		origin: 'printed',
		internal_code: null,
		barcode: null,
		commercial_status: status,
		financial_status_snapshot: 'no_payments',
		current_collector_id: 'c0000000-0000-0000-0000-000000000001',
		current_buyer_id: null,
		commercial_unit_count: 1,
		total_value: '60000.00',
		annulled_at: null,
		annulled_by: null,
		annul_reason: null,
		annulled_from_status: null,
		created_by: profile.id,
		created_at: '2026-11-17T12:00:00+00:00',
		updated_at: '2026-11-17T12:00:00+00:00'
	};
}

function locals(
	permissions: string[] | null,
	status = 'delivered_to_collector',
	campaignId = CAMPAIGN_ID
) {
	const mock = mockSupabase({
		tables: {
			campaigns: { data: campaignRow({ status: 'active' as never }), error: null },
			bonds: { data: { ...bondRow(status), campaign_id: campaignId }, error: null },
			bond_numbers: { data: [], error: null },
			bond_groups: { data: [], error: null },
			bond_list: { data: [], error: null },
			bond_assignments: { data: [], error: null },
			collectors: { data: [], error: null },
			audit_log: { data: [], error: null }
		}
	});
	return makeLocals({ supabase: mock.supabase, permissions });
}

function correct(l: App.Locals, fields: Record<string, string>) {
	const url = `http://localhost/campaigns/${CAMPAIGN_ID}/bonds/${BOND_ID}?/correctCollector`;
	return (
		actions.correctCollector({
			locals: l,
			params: { id: CAMPAIGN_ID, bondId: BOND_ID },
			url: new URL(url),
			request: postRequest(url, fields)
		} as never) as Promise<unknown>
	).catch((err) => err) as Promise<
		{ status?: number; data?: Record<string, unknown> } & Record<string, unknown>
	>;
}

const unsold = { sold: 'false', newCollectorId: TARGET, reason: 'Delivered to the wrong person' };
const sold = { ...unsold, sold: 'true' };

describe('bond record: correct collector (SAN-73)', () => {
	beforeEach(() => {
		vi.mocked(correctBondCollector).mockReset();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	it('answers 500 when permissions could not be loaded', async () => {
		const result = await correct(locals(null), unsold);
		expect(result.status).toBe(500);
		expect(correctBondCollector).not.toHaveBeenCalled();
	});

	it('requires bond.assign for an unsold bond and sale.correct for a sold one', async () => {
		expect((await correct(locals(BASE), unsold)).status).toBe(403);
		expect((await correct(locals([...BASE, 'bond.assign']), sold)).status).toBe(403);
		expect(correctBondCollector).not.toHaveBeenCalled();
	});

	it('404s a bond of another campaign', async () => {
		const other = locals(
			[...BASE, 'bond.assign'],
			'delivered_to_collector',
			'a0000000-0000-0000-0000-000000000099'
		);
		expect((await correct(other, unsold)).status).toBe(404);
	});

	it('records the correction with the request context', async () => {
		vi.mocked(correctBondCollector).mockResolvedValue(undefined as never);
		const result = await correct(locals([...BASE, 'sale.correct']), sold);
		expect(result).toMatchObject({ form: 'correctCollector', success: true });
		expect(correctBondCollector).toHaveBeenCalledWith(
			expect.anything(),
			{
				bondId: BOND_ID,
				sold: true,
				newCollectorId: TARGET,
				reason: 'Delivered to the wrong person'
			},
			expect.objectContaining({ permissions: expect.arrayContaining(['sale.correct']) })
		);
	});

	it('maps service errors (validation, conflict) to their status and keeps the values', async () => {
		vi.mocked(correctBondCollector).mockRejectedValue(
			new SaleCorrectionServiceError('conflict', 'Remove open-settlement payments first.')
		);
		const result = await correct(locals([...BASE, 'sale.correct']), sold);
		expect(result.status).toBe(409);
		expect(result.data).toMatchObject({ message: 'Remove open-settlement payments first.' });
		vi.mocked(correctBondCollector).mockRejectedValue(
			new SaleCorrectionServiceError(
				'validation',
				'Se requiere un motivo de hasta 1000 caracteres.'
			)
		);
		expect(
			(await correct(locals([...BASE, 'sale.correct']), { ...sold, reason: 'x'.repeat(1001) }))
				.status
		).toBe(400);
	});

	it('offers the correction only with the matching permission', async () => {
		const delivered = (await load({
			locals: locals([...BASE, 'bond.assign']),
			params: { id: CAMPAIGN_ID, bondId: BOND_ID },
			url: new URL(`http://localhost/campaigns/${CAMPAIGN_ID}/bonds/${BOND_ID}`)
		} as never))!;
		expect(delivered.custody.can.correctCollector).toBe(true);
		const soldNoPermission = (await load({
			locals: locals([...BASE, 'bond.assign'], 'sold'),
			params: { id: CAMPAIGN_ID, bondId: BOND_ID },
			url: new URL(`http://localhost/campaigns/${CAMPAIGN_ID}/bonds/${BOND_ID}`)
		} as never))!;
		expect(soldNoPermission.custody.can.correctCollector).toBe(false);
	});
});

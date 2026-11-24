import { beforeEach, describe, expect, it, vi } from 'vitest';
import { load } from './+page.server';
import { CAMPAIGN_ID, campaignRow, makeLocals, mockSupabase } from '../../../../test-helpers';

vi.mock('$lib/server/repositories/deliveries', () => ({
	getDeliveryNote: vi.fn(),
	listDeliveryNoteBonds: vi.fn()
}));
import { getDeliveryNote, listDeliveryNoteBonds } from '$lib/server/repositories/deliveries';

const NOTE_ID = 'd0000000-0000-0000-0000-000000000001';
const VIEWER = ['campaign.view', 'bond.view'];

function event(locals: App.Locals, noteId = NOTE_ID, id = CAMPAIGN_ID) {
	return {
		locals,
		params: { id, noteId },
		url: new URL(`http://localhost/campaigns/${id}/deliveries/${noteId}/print`)
	} as unknown as Parameters<typeof load>[0];
}

function setup(permissions = VIEWER) {
	const { supabase } = mockSupabase({
		tables: { campaigns: { data: campaignRow(), error: null } }
	});
	return makeLocals({ supabase, permissions });
}

describe('/campaigns/[id]/deliveries/[noteId]/print', () => {
	beforeEach(() => {
		vi.mocked(getDeliveryNote).mockReset();
		vi.mocked(listDeliveryNoteBonds).mockReset();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	it('requires bond.view, including for bond.assign users', async () => {
		await expect(load(event(setup(['campaign.view'])))).rejects.toMatchObject({ status: 403 });
		await expect(load(event(setup(['campaign.view', 'bond.assign'])))).rejects.toMatchObject({
			status: 403
		});
	});

	it('404 for a malformed note id or a note of another campaign', async () => {
		await expect(load(event(setup(), 'nope'))).rejects.toMatchObject({ status: 404 });
		vi.mocked(getDeliveryNote).mockResolvedValue({ data: null, error: null });
		await expect(load(event(setup()))).rejects.toMatchObject({ status: 404 });
	});

	it('builds the printable document', async () => {
		vi.mocked(getDeliveryNote).mockResolvedValue({
			data: {
				note: {
					id: NOTE_ID,
					campaignId: CAMPAIGN_ID,
					noteNumber: 3,
					collectorId: 'c',
					collectorName: 'Ana',
					status: 'issued',
					reason: 'delivery',
					issuedAt: '2026-11-18T15:30:00Z',
					createdBy: 'u',
					createdByName: 'Op',
					notes: null,
					bondCount: 0
				},
				bondIds: []
			},
			error: null
		});
		vi.mocked(listDeliveryNoteBonds).mockResolvedValue({ data: [], error: null });
		const data = (await load(event(setup())))!;
		expect(data.document).toMatchObject({
			deliveryNoteNumber: 'Remito 0003',
			collector: 'Ana',
			bondCount: 0
		});
	});

	it('logs and fails when RLS hides a bond on the note', async () => {
		vi.mocked(getDeliveryNote).mockResolvedValue({
			data: {
				note: {
					id: NOTE_ID,
					campaignId: CAMPAIGN_ID,
					noteNumber: 3,
					collectorId: 'c',
					collectorName: 'Ana',
					status: 'issued',
					reason: 'delivery',
					issuedAt: '2026-11-18T15:30:00Z',
					createdBy: 'u',
					createdByName: 'Op',
					notes: null,
					bondCount: 1
				},
				bondIds: ['b']
			},
			error: null
		});
		vi.mocked(listDeliveryNoteBonds).mockResolvedValue({ data: [], error: null });

		await expect(load(event(setup()))).rejects.toMatchObject({ status: 500 });
		expect(console.error).toHaveBeenCalledWith(
			'[deliveries] print load failed',
			expect.objectContaining({ noteId: NOTE_ID, error: expect.any(Error) })
		);
	});
});

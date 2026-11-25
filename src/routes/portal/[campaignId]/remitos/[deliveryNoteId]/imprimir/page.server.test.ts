import { beforeEach, describe, expect, it, vi } from 'vitest';
import { load } from './+page.server';
import {
	CAMPAIGN_ID,
	campaignRow,
	makeLocals,
	mockSupabase
} from '../../../../../campaigns/test-helpers';

vi.mock('$lib/server/repositories/deliveries', () => ({
	getDeliveryNote: vi.fn(),
	listDeliveryNoteBonds: vi.fn()
}));
import { getDeliveryNote, listDeliveryNoteBonds } from '$lib/server/repositories/deliveries';

const NOTE_ID = 'd0000000-0000-0000-0000-000000000001';
const COLLECTOR = {
	id: 'c0000000-0000-0000-0000-000000000001',
	display_name: 'Ana',
	status: 'active'
};
const OWN = ['campaign.view', 'bond.view_own'];

const note = (overrides = {}) => ({
	id: NOTE_ID,
	campaignId: CAMPAIGN_ID,
	noteNumber: 3,
	collectorId: COLLECTOR.id,
	collectorName: 'Ana',
	status: 'issued',
	reason: 'delivery',
	issuedAt: '2026-11-18T15:30:00Z',
	createdBy: 'u',
	createdByName: null,
	notes: null,
	bondCount: 0,
	...overrides
});

function event(locals: App.Locals, deliveryNoteId = NOTE_ID, campaignId = CAMPAIGN_ID) {
	return {
		locals,
		params: { campaignId, deliveryNoteId },
		url: new URL(`http://localhost/portal/${campaignId}/remitos/${deliveryNoteId}/imprimir`)
	} as unknown as Parameters<typeof load>[0];
}

function setup(permissions: string[] | null = OWN, rpcData: unknown = [COLLECTOR]) {
	const { supabase } = mockSupabase({
		tables: { campaigns: { data: campaignRow(), error: null } },
		rpc: { data: rpcData, error: null }
	});
	return makeLocals({ supabase, permissions });
}

describe('/portal/[campaignId]/remitos/[deliveryNoteId]/imprimir', () => {
	beforeEach(() => {
		vi.mocked(getDeliveryNote).mockReset();
		vi.mocked(listDeliveryNoteBonds).mockReset();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	it('requires bond.view_own: 403 without it, 500 when permissions did not load', async () => {
		await expect(load(event(setup(['campaign.view'])))).rejects.toMatchObject({ status: 403 });
		await expect(load(event(setup(null)))).rejects.toMatchObject({ status: 500 });
	});

	it('404 for malformed ids, an unlinked profile, an unknown note or a note of another collector', async () => {
		await expect(load(event(setup(), 'nope'))).rejects.toMatchObject({ status: 404 });
		await expect(load(event(setup(), NOTE_ID, 'nope'))).rejects.toMatchObject({ status: 404 });
		await expect(load(event(setup(OWN, [])))).rejects.toMatchObject({ status: 404 });
		vi.mocked(getDeliveryNote).mockResolvedValue({ data: null, error: null });
		await expect(load(event(setup()))).rejects.toMatchObject({ status: 404 });
		vi.mocked(getDeliveryNote).mockResolvedValue({
			data: { note: note({ collectorId: 'c0000000-0000-0000-0000-000000000002' }), bondIds: [] },
			error: null
		} as never);
		await expect(load(event(setup()))).rejects.toMatchObject({ status: 404 });
		expect(listDeliveryNoteBonds).not.toHaveBeenCalled();
	});

	it('builds the same printable document for an own note, without the registering user', async () => {
		vi.mocked(getDeliveryNote).mockResolvedValue({
			data: { note: note(), bondIds: [] },
			error: null
		} as never);
		vi.mocked(listDeliveryNoteBonds).mockResolvedValue({ data: [], error: null });
		const data = (await load(event(setup())))!;
		expect(data.document).toMatchObject({
			deliveryNoteNumber: 'Remito 0003',
			collector: 'Ana',
			registeredBy: 'Administración',
			bondCount: 0
		});
		expect(JSON.stringify(data.document)).not.toMatch(/buyer|comprador/i);
	});

	it('404 instead of a partial note when some bonds are no longer readable', async () => {
		vi.mocked(getDeliveryNote).mockResolvedValue({
			data: { note: note({ bondCount: 2 }), bondIds: ['a', 'b'] },
			error: null
		} as never);
		vi.mocked(listDeliveryNoteBonds).mockResolvedValue({ data: [], error: null });
		await expect(load(event(setup()))).rejects.toMatchObject({ status: 404 });
	});

	it('500 and a log when the read fails', async () => {
		vi.mocked(getDeliveryNote).mockResolvedValue({ data: null, error: new Error('boom') });
		await expect(load(event(setup()))).rejects.toMatchObject({ status: 500 });
		expect(console.error).toHaveBeenCalled();
	});
});

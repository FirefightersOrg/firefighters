import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	CAMPAIGN_COLUMNS,
	getCampaignById,
	listCampaigns,
	mapCampaignRow,
	type CampaignRow
} from './campaigns';

const row: CampaignRow = {
	id: 'f0000000-0000-0000-0000-000000000001',
	name: 'Campaign 2027',
	status: 'draft',
	starts_at: null,
	ends_at: '2027-12-31T23:59:59-03:00',
	simple_bond_value: '60000.00',
	installment_count: 10,
	installment_value: '6000.00',
	number_digits: 4,
	max_number: 9999,
	associated_number_offset: 4871,
	associated_number_mode: 'linear',
	overflow_policy: 'reject',
	barcode_mode: 'base_number',
	barcode_pattern: null,
	created_by: 'e0000000-0000-0000-0000-000000000001',
	created_at: '2026-11-16T12:00:00+00:00',
	updated_at: '2026-11-16T12:00:00+00:00'
};

describe('campaigns repository', () => {
	it('selects money as text so values stay exact', () => {
		expect(CAMPAIGN_COLUMNS).toContain('simple_bond_value::text');
		expect(CAMPAIGN_COLUMNS).toContain('installment_value::text');
	});

	it('maps a row to the app type', () => {
		expect(mapCampaignRow(row)).toEqual({
			id: row.id,
			name: 'Campaign 2027',
			status: 'draft',
			startsAt: null,
			endsAt: '2027-12-31T23:59:59-03:00',
			simpleBondValue: '60000.00',
			installmentCount: 10,
			installmentValue: '6000.00',
			numberDigits: 4,
			maxNumber: 9999,
			associatedNumberOffset: 4871,
			associatedNumberMode: 'linear',
			overflowPolicy: 'reject',
			barcodeMode: 'base_number',
			barcodePattern: null,
			createdBy: row.created_by,
			createdAt: row.created_at,
			updatedAt: row.updated_at
		});
	});

	it('normalizes money returned as JSON numbers', () => {
		const mapped = mapCampaignRow({ ...row, simple_bond_value: 60000, installment_value: 8571.5 });
		expect(mapped.simpleBondValue).toBe('60000.00');
		expect(mapped.installmentValue).toBe('8571.50');
	});

	it('rejects unknown enum values instead of passing them through', () => {
		expect(() => mapCampaignRow({ ...row, status: 'paused' })).toThrow(/campaigns.status/);
		expect(() => mapCampaignRow({ ...row, barcode_mode: 'qr' })).toThrow(/campaigns.barcode_mode/);
	});

	it('lists campaigns newest first and returns errors instead of throwing', async () => {
		const overrideTypes = vi.fn().mockResolvedValue({ data: [row], error: null });
		const order2 = vi.fn().mockReturnValue({ overrideTypes });
		const order1 = vi.fn().mockReturnValue({ order: order2 });
		const select = vi.fn().mockReturnValue({ order: order1 });
		const from = vi.fn().mockReturnValue({ select });
		const supabase = { from } as unknown as SupabaseClient;

		const result = await listCampaigns(supabase);
		expect(from).toHaveBeenCalledWith('campaigns');
		expect(order1).toHaveBeenCalledWith('created_at', { ascending: false });
		expect(result.data?.[0].name).toBe('Campaign 2027');

		overrideTypes.mockResolvedValueOnce({ data: null, error: { message: 'boom', code: 'XX000' } });
		await expect(listCampaigns(supabase)).resolves.toMatchObject({
			data: null,
			error: { message: 'boom' }
		});

		overrideTypes.mockResolvedValueOnce({ data: [{ ...row, status: 'paused' }], error: null });
		const bad = await listCampaigns(supabase);
		expect(bad.data).toBeNull();
		expect(bad.error).toBeInstanceOf(Error);
	});

	it('gets one campaign, or null when not visible', async () => {
		const overrideTypes = vi.fn().mockResolvedValue({ data: row, error: null });
		const maybeSingle = vi.fn().mockReturnValue({ overrideTypes });
		const eq = vi.fn().mockReturnValue({ maybeSingle });
		const supabase = {
			from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ eq }) })
		} as unknown as SupabaseClient;

		await expect(getCampaignById(supabase, row.id)).resolves.toMatchObject({
			data: { id: row.id },
			error: null
		});
		expect(eq).toHaveBeenCalledWith('id', row.id);

		overrideTypes.mockResolvedValueOnce({ data: null, error: null });
		await expect(getCampaignById(supabase, row.id)).resolves.toEqual({ data: null, error: null });
	});
});

/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('$lib/server/repositories/campaigns', () => ({ getCampaignById: vi.fn() }));
vi.mock('$lib/server/services/draws', async (original) => ({
	...(await original<any>()),
	createDraw: vi.fn()
}));
import { actions, load } from './+page.server';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { createDraw, DrawServiceError } from '$lib/server/services/draws';
import { CAMPAIGN_ID, makeLocals } from '../../../test-helpers';
const url = `http://localhost/campaigns/${CAMPAIGN_ID}/draws/new`;
const run = async (permissions: string[] | null, fields: Record<string, string>) => {
	const body = new FormData();
	Object.entries(fields).forEach(([key, value]) => body.set(key, value));
	try {
		return await actions.create({
			locals: makeLocals({ permissions }),
			params: { id: CAMPAIGN_ID },
			url: new URL(url),
			request: new Request(url, { method: 'POST', body })
		} as never);
	} catch (cause) {
		return cause;
	}
};
const valid = {
	drawType: 'monthly',
	name: 'December',
	drawDate: '2026-12-10',
	paymentCutoffLocal: '2026-12-01T00:00',
	requiredInstallmentNumber: '3'
};
beforeEach(() => {
	vi.mocked(getCampaignById).mockResolvedValue({
		data: { id: CAMPAIGN_ID, installmentCount: 10 },
		error: null
	} as never);
	vi.mocked(createDraw).mockResolvedValue('d0000000-0000-4000-8000-000000000001');
});
describe('new draw', () => {
	it('fails closed and denies load/action before reads or writes', async () => {
		await expect(
			load({
				locals: makeLocals({ permissions: null }),
				params: { id: CAMPAIGN_ID },
				url: new URL(url)
			} as never)
		).rejects.toMatchObject({ status: 500 });
		expect(await run(['campaign.view'], valid)).toMatchObject({ status: 403 });
		expect(await run(null, valid)).toMatchObject({ status: 500 });
		expect(createDraw).not.toHaveBeenCalled();
	});
	it('validates and converts Buenos Aires midnight', async () => {
		expect(
			await run(['campaign.view', 'draw.create'], { ...valid, requiredInstallmentNumber: '11' })
		).toMatchObject({ status: 400 });
		await run(['campaign.view', 'draw.create'], valid);
		expect(createDraw).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ paymentCutoffAt: '2026-12-01T00:00:00-03:00' }),
			expect.anything()
		);
	});
	it('maps service errors and redirects after the try', async () => {
		vi.mocked(createDraw).mockRejectedValueOnce(
			new DrawServiceError('conflict', 'Already exists.')
		);
		expect(await run(['campaign.view', 'draw.create'], valid)).toMatchObject({ status: 409 });
		expect(await run(['campaign.view', 'draw.create'], valid)).toMatchObject({ status: 303 });
	});
});

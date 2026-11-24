/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('$lib/server/repositories/campaigns', () => ({ getCampaignById: vi.fn() }));
vi.mock('$lib/server/repositories/draws', () => ({
	getDraw: vi.fn(),
	getCurrentDrawRoster: vi.fn()
}));
vi.mock('$lib/server/services/draws', async (original) => ({
	...(await original<any>()),
	updateDraw: vi.fn(),
	annulDraw: vi.fn(),
	completeDraw: vi.fn()
}));
vi.mock('$lib/server/services/draw-rosters', async (original) => ({
	...(await original<any>()),
	generateDrawRoster: vi.fn(),
	freezeDrawRoster: vi.fn()
}));
import { actions, load } from './+page.server';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { getCurrentDrawRoster, getDraw } from '$lib/server/repositories/draws';
import { annulDraw, completeDraw, DrawServiceError, updateDraw } from '$lib/server/services/draws';
import { freezeDrawRoster, generateDrawRoster } from '$lib/server/services/draw-rosters';
import { buenosAiresDateTimeLocal } from '$lib/domain/draws-datetime';
import { CAMPAIGN_ID, makeLocals } from '../../../test-helpers';
const DRAW_ID = 'd0000000-0000-4000-8000-000000000001';
const url = `http://localhost/campaigns/${CAMPAIGN_ID}/draws/${DRAW_ID}`;
const draw = {
	id: DRAW_ID,
	campaignId: CAMPAIGN_ID,
	drawType: 'monthly',
	name: 'December',
	drawDate: '2026-12-10',
	paymentCutoffAt: '2026-12-01T00:00:00-03:00',
	requiredInstallmentNumber: 3,
	eligibilityRule: {},
	status: 'scheduled'
};
const run = async (
	action: keyof typeof actions,
	permissions: string[] | null,
	fields: Record<string, string> = {}
) => {
	const body = new FormData();
	Object.entries(fields).forEach(([key, value]) => body.set(key, value));
	return actions[action]({
		locals: makeLocals({ permissions }),
		params: { id: CAMPAIGN_ID, drawId: DRAW_ID },
		url: new URL(url),
		request: new Request(url, { method: 'POST', body })
	} as never);
};
beforeEach(() => {
	vi.mocked(getCampaignById).mockResolvedValue({
		data: { id: CAMPAIGN_ID, installmentCount: 10 },
		error: null
	} as never);
	vi.mocked(getDraw).mockResolvedValue({ data: draw, error: null } as never);
	vi.mocked(getCurrentDrawRoster).mockResolvedValue({ data: null, error: null });
});
describe('draw detail', () => {
	it('draw.update permits editing but not annulment or completion', async () => {
		const loaded = (await load({
			locals: makeLocals({ permissions: ['campaign.view', 'draw.update'] }),
			params: { id: CAMPAIGN_ID, drawId: DRAW_ID },
			url: new URL(url)
		} as never)) as any;
		expect(loaded.can).toMatchObject({ edit: true, annul: false, complete: false });
		expect(
			await run('annul', ['campaign.view', 'draw.update'], { reason: 'Reason' })
		).toMatchObject({ status: 403 });
		expect(annulDraw).not.toHaveBeenCalled();
	});
	it('offers annulment to draw.annul without edit permission', async () => {
		const loaded = (await load({
			locals: makeLocals({ permissions: ['campaign.view', 'draw.view', 'draw.annul'] }),
			params: { id: CAMPAIGN_ID, drawId: DRAW_ID },
			url: new URL(url)
		} as never)) as any;
		expect(loaded.can).toMatchObject({ edit: false, annul: true, complete: false });
		expect(await run('annul', ['campaign.view', 'draw.annul'], { reason: 'Reason' })).toMatchObject(
			{ success: true }
		);
	});
	it('fails closed and denies load', async () => {
		await expect(
			load({
				locals: makeLocals({ permissions: null }),
				params: { id: CAMPAIGN_ID, drawId: DRAW_ID },
				url: new URL(url)
			} as never)
		).rejects.toMatchObject({ status: 500 });
		await expect(
			load({
				locals: makeLocals({ permissions: ['campaign.view'] }),
				params: { id: CAMPAIGN_ID, drawId: DRAW_ID },
				url: new URL(url)
			} as never)
		).rejects.toMatchObject({ status: 403 });
	});
	it.each([
		['update', 'draw.update'],
		['annul', 'draw.annul'],
		['generate', 'draw.generate_roster'],
		['freeze', 'draw.freeze_roster']
	] as const)('denies %s without %s and performs no write', async (action, permission) => {
		expect(permission).toMatch(/^draw\./);
		expect(await run(action, ['campaign.view'])).toMatchObject({ status: 403 });
		expect(updateDraw).not.toHaveBeenCalled();
		expect(annulDraw).not.toHaveBeenCalled();
		expect(generateDrawRoster).not.toHaveBeenCalled();
		expect(freezeDrawRoster).not.toHaveBeenCalled();
	});
	it.each(['update', 'annul', 'generate', 'freeze'] as const)(
		'fails closed on %s when permissions are unavailable',
		async (action) => {
			expect(await run(action, null)).toMatchObject({ status: 500 });
			expect(updateDraw).not.toHaveBeenCalled();
			expect(annulDraw).not.toHaveBeenCalled();
			expect(generateDrawRoster).not.toHaveBeenCalled();
			expect(freezeDrawRoster).not.toHaveBeenCalled();
		}
	);
	it('validates a 1001-code-point annulment reason and freeze confirmation', async () => {
		expect(
			await run('annul', ['campaign.view', 'draw.annul'], { reason: '🧯'.repeat(1001) })
		).toMatchObject({ status: 400 });
		expect(await run('freeze', ['campaign.view', 'draw.freeze_roster'])).toMatchObject({
			status: 400
		});
	});
	it('maps service errors', async () => {
		vi.mocked(generateDrawRoster).mockRejectedValueOnce(
			new DrawServiceError('conflict', 'Results required.')
		);
		expect(await run('generate', ['campaign.view', 'draw.generate_roster'])).toMatchObject({
			status: 409
		});
	});
	it('preserves a UTC cutoff instant through load, edit form value, and save', async () => {
		const utcCutoff = '2026-11-20T03:00:00+00:00';
		vi.mocked(getDraw).mockResolvedValue({
			data: { ...draw, paymentCutoffAt: utcCutoff },
			error: null
		} as never);
		const loaded = (await load({
			locals: makeLocals({ permissions: ['campaign.view', 'draw.update'] }),
			params: { id: CAMPAIGN_ID, drawId: DRAW_ID },
			url: new URL(url)
		} as never)) as { draw: typeof draw };
		const paymentCutoffLocal = buenosAiresDateTimeLocal(loaded.draw.paymentCutoffAt);

		await run('update', ['campaign.view', 'draw.update'], {
			name: draw.name,
			drawDate: draw.drawDate,
			paymentCutoffLocal,
			requiredInstallmentNumber: '3',
			consolationRequiredInstallmentNumber: ''
		});

		expect(paymentCutoffLocal).toBe('2026-11-20T00:00');
		expect(updateDraw).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ paymentCutoffAt: '2026-11-20T00:00:00-03:00' }),
			expect.anything()
		);
		const saved = vi.mocked(updateDraw).mock.calls.at(-1)?.[1].paymentCutoffAt;
		expect(Date.parse(saved as string)).toBe(Date.parse(utcCutoff));
	});
	describe('complete (SAN-123)', () => {
		const frozen = { ...draw, status: 'roster_frozen' };
		const loadAs = async (permissions: string[], status: string) => {
			vi.mocked(getDraw).mockResolvedValue({ data: { ...draw, status }, error: null } as never);
			return (await load({
				locals: makeLocals({ permissions }),
				params: { id: CAMPAIGN_ID, drawId: DRAW_ID },
				url: new URL(url)
			} as never)) as any;
		};
		beforeEach(() => {
			vi.mocked(completeDraw).mockReset();
			vi.mocked(getDraw).mockResolvedValue({ data: frozen, error: null } as never);
		});
		it('is offered only on a frozen draw with draw.complete', async () => {
			expect(
				(await loadAs(['campaign.view', 'draw.view', 'draw.complete'], 'roster_frozen')).can
					.complete
			).toBe(true);
			expect((await loadAs(['campaign.view', 'draw.view'], 'roster_frozen')).can.complete).toBe(
				false
			);
			expect((await loadAs(['campaign.view', 'draw.update'], 'roster_frozen')).can.complete).toBe(
				false
			);
			expect(
				(await loadAs(['campaign.view', 'draw.view', 'draw.complete'], 'roster_generated')).can
					.complete
			).toBe(false);
			expect(
				(await loadAs(['campaign.view', 'draw.view', 'draw.complete'], 'completed')).can.complete
			).toBe(false);
		});
		it('denies with draw.update alone and fails closed without permissions', async () => {
			expect(await run('complete', ['campaign.view', 'draw.update'])).toMatchObject({
				status: 403
			});
			expect(await run('complete', null)).toMatchObject({ status: 500 });
			expect(completeDraw).not.toHaveBeenCalled();
		});
		it('404s a draw outside the route campaign', async () => {
			vi.mocked(getDraw).mockResolvedValue({ data: null, error: null } as never);
			expect(await run('complete', ['campaign.view', 'draw.complete'])).toMatchObject({
				status: 404
			});
			expect(completeDraw).not.toHaveBeenCalled();
		});
		it('completes with the request context', async () => {
			vi.mocked(completeDraw).mockResolvedValue(undefined);
			expect(await run('complete', ['campaign.view', 'draw.complete'])).toMatchObject({
				form: 'complete',
				success: true
			});
			expect(completeDraw).toHaveBeenCalledWith(
				expect.anything(),
				{ drawId: DRAW_ID },
				expect.objectContaining({ permissions: expect.arrayContaining(['draw.complete']) })
			);
		});
		it('maps unresolved prizes to a 409 with the service message', async () => {
			vi.mocked(completeDraw).mockRejectedValue(
				new DrawServiceError('conflict', 'resolve every prize of the draw before completing it')
			);
			const result = (await run('complete', ['campaign.view', 'draw.complete'])) as any;
			expect(result.status).toBe(409);
			expect(result.data).toMatchObject({ form: 'complete' });
		});
	});
});

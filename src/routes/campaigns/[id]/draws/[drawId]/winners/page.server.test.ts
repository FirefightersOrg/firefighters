/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/repositories/campaigns', () => ({ getCampaignById: vi.fn() }));
vi.mock('$lib/server/repositories/draws', () => ({ getDraw: vi.fn() }));
vi.mock('$lib/server/repositories/prizes', () => ({
	listDrawPrizes: vi.fn(),
	getPrizeInDraw: vi.fn()
}));
vi.mock('$lib/server/services/prizes', async (original) => ({
	...(await original<any>()),
	createPrize: vi.fn(),
	updatePrize: vi.fn(),
	loadWinningNumber: vi.fn(),
	resolvePrize: vi.fn(),
	deliverPrize: vi.fn(),
	reversePrizeDelivery: vi.fn(),
	annulPrize: vi.fn()
}));

import { actions, load } from './+page.server';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { getDraw } from '$lib/server/repositories/draws';
import { getPrizeInDraw, listDrawPrizes } from '$lib/server/repositories/prizes';
import {
	annulPrize,
	createPrize,
	deliverPrize,
	loadWinningNumber,
	PrizeServiceError,
	resolvePrize,
	reversePrizeDelivery,
	updatePrize
} from '$lib/server/services/prizes';
import { CAMPAIGN_ID, campaignRow, makeLocals } from '../../../../test-helpers';

const DRAW_ID = 'd0000000-0000-4000-8000-000000000001';
const PRIZE_ID = 'a0000000-0000-4000-8000-000000000001';
const PAGE_URL = `http://localhost/campaigns/${CAMPAIGN_ID}/draws/${DRAW_ID}/winners`;
const draw = {
	id: DRAW_ID,
	campaignId: CAMPAIGN_ID,
	drawType: 'monthly',
	name: 'December',
	drawDate: '2026-12-10',
	paymentCutoffAt: '2026-12-01T03:00:00+00:00',
	requiredInstallmentNumber: 3,
	eligibilityRule: {},
	status: 'roster_frozen'
};
const prize = {
	id: PRIZE_ID,
	drawId: DRAW_ID,
	name: 'Bike',
	description: null,
	position: 1,
	status: 'pending_validation',
	excludesFromConsolation: true,
	annulledAt: null,
	annulReason: null,
	winningNumber: null
};
const writeMocks = [
	createPrize,
	updatePrize,
	loadWinningNumber,
	resolvePrize,
	deliverPrize,
	annulPrize,
	reversePrizeDelivery
] as const;

const run = async (
	action: keyof typeof actions,
	permissions: string[] | null,
	fields: Record<string, string> = {}
) => {
	const body = new FormData();
	for (const [key, value] of Object.entries(fields)) body.set(key, value);
	return actions[action]({
		locals: makeLocals({ permissions }),
		params: { id: CAMPAIGN_ID, drawId: DRAW_ID },
		url: new URL(`${PAGE_URL}?/${action}`),
		request: new Request(PAGE_URL, { method: 'POST', body })
	} as never);
};

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(getCampaignById).mockResolvedValue({
		data: {
			...campaignRow({ status: 'active' }),
			id: CAMPAIGN_ID,
			numberDigits: 4,
			maxNumber: 9999,
			associatedNumberOffset: 4871,
			associatedNumberMode: 'linear',
			overflowPolicy: 'reject'
		},
		error: null
	} as never);
	vi.mocked(getDraw).mockResolvedValue({ data: draw, error: null } as never);
	vi.mocked(listDrawPrizes).mockResolvedValue({ data: [prize], error: null } as never);
	vi.mocked(getPrizeInDraw).mockResolvedValue({ data: prize, error: null } as never);
});

describe('winner loading and prize management server', () => {
	it('exposes the reversal capability only with its dedicated permission', async () => {
		for (const allowed of [true, false]) {
			const result = await load({
				locals: makeLocals({
					permissions: [
						'campaign.view',
						'draw.view',
						...(allowed ? ['prize.reverse_delivery'] : [])
					]
				}),
				params: { id: CAMPAIGN_ID, drawId: DRAW_ID },
				url: new URL(PAGE_URL)
			} as never);
			expect(result).toMatchObject({ can: { reverseDelivery: allowed } });
		}
	});
	it('scopes, validates, calls and maps reversal failures', async () => {
		const permissions = ['campaign.view', 'prize.reverse_delivery'];
		for (const reason of ['', ' ', '🧯'.repeat(1001)]) {
			expect(
				await run('reverseDelivery', permissions, { prizeId: PRIZE_ID, reason })
			).toMatchObject({ status: 400 });
		}
		expect(reversePrizeDelivery).not.toHaveBeenCalled();
		vi.mocked(getPrizeInDraw).mockResolvedValueOnce({ data: null, error: null });
		expect(
			await run('reverseDelivery', permissions, { prizeId: PRIZE_ID, reason: 'Mistake' })
		).toMatchObject({ status: 404 });
		expect(reversePrizeDelivery).not.toHaveBeenCalled();
		for (const kind of ['conflict', 'permission', 'validation', 'not_found', 'internal'] as const) {
			const cause = new PrizeServiceError(kind, 'Reversal failed');
			vi.mocked(reversePrizeDelivery).mockRejectedValueOnce(cause);
			expect(
				await run('reverseDelivery', permissions, { prizeId: PRIZE_ID, reason: 'Mistake' })
			).toMatchObject({ status: cause.status });
		}
		vi.mocked(reversePrizeDelivery).mockResolvedValueOnce(undefined);
		expect(
			await run('reverseDelivery', permissions, { prizeId: PRIZE_ID, reason: ' Mistake ' })
		).toMatchObject({ success: true, form: 'reverseDelivery' });
		expect(reversePrizeDelivery).toHaveBeenLastCalledWith(
			expect.anything(),
			{ prizeId: PRIZE_ID, reason: 'Mistake' },
			{ permissions, requestId: 'req-test' }
		);
	});
	it('fails closed and denies the load', async () => {
		await expect(
			load({
				locals: makeLocals({ permissions: null }),
				params: { id: CAMPAIGN_ID, drawId: DRAW_ID },
				url: new URL(PAGE_URL)
			} as never)
		).rejects.toMatchObject({ status: 500 });
		await expect(
			load({
				locals: makeLocals({ permissions: ['campaign.view'] }),
				params: { id: CAMPAIGN_ID, drawId: DRAW_ID },
				url: new URL(PAGE_URL)
			} as never)
		).rejects.toMatchObject({ status: 403 });
		expect(listDrawPrizes).not.toHaveBeenCalled();
	});

	it.each([
		['create', 'draw.update'],
		['update', 'draw.update'],
		['loadWinner', 'draw.load_winner'],
		['resolve', 'prize.resolve'],
		['deliver', 'prize.deliver'],
		['reverseDelivery', 'prize.reverse_delivery'],
		['annul', 'prize.annul']
	] as const)('denies %s without %s before reads or writes', async (action, permission) => {
		expect(permission).toMatch(/^(draw|prize)\./);
		expect(await run(action, ['campaign.view'])).toMatchObject({ status: 403 });
		expect(getPrizeInDraw).not.toHaveBeenCalled();
		for (const write of writeMocks) expect(write).not.toHaveBeenCalled();
	});

	it.each([
		'create',
		'update',
		'loadWinner',
		'resolve',
		'deliver',
		'annul',
		'reverseDelivery'
	] as const)('fails closed on %s when permissions are unavailable', async (action) => {
		expect(await run(action, null)).toMatchObject({ status: 500 });
		for (const write of writeMocks) expect(write).not.toHaveBeenCalled();
	});

	it('validates 1001 Unicode code points and required delivery notes without writing', async () => {
		expect(
			await run('annul', ['campaign.view', 'prize.annul'], {
				prizeId: PRIZE_ID,
				reason: '🧯'.repeat(1001)
			})
		).toMatchObject({ status: 400 });
		expect(
			await run('deliver', ['campaign.view', 'prize.deliver'], {
				prizeId: PRIZE_ID,
				notes: ''
			})
		).toMatchObject({ status: 400 });
		expect(annulPrize).not.toHaveBeenCalled();
		expect(deliverPrize).not.toHaveBeenCalled();
	});

	it('verifies a form prize belongs to the route draw before calling the service', async () => {
		vi.mocked(getPrizeInDraw).mockResolvedValueOnce({ data: null, error: null });
		expect(
			await run('resolve', ['campaign.view', 'prize.resolve'], {
				prizeId: PRIZE_ID,
				decision: 'award'
			})
		).toMatchObject({ status: 404 });
		expect(resolvePrize).not.toHaveBeenCalled();
	});

	it('returns the Spanish no-match explanation computed by the server', async () => {
		const loadedPrize = {
			...prize,
			winningNumber: {
				id: 'w',
				numberValue: 9999,
				resultStatus: 'no_match',
				notes: null,
				loadedAt: '2026-11-20T02:30:00+00:00',
				matchedRosterEntryId: null,
				eligible: null,
				ineligibilityReason: null,
				bondId: null,
				bondLabel: null,
				buyerLabel: null,
				collectorLabel: null
			}
		};
		vi.mocked(getPrizeInDraw)
			.mockResolvedValueOnce({ data: prize, error: null } as never)
			.mockResolvedValueOnce({ data: loadedPrize, error: null } as never);
		const result = await run('loadWinner', ['campaign.view', 'draw.load_winner'], {
			prizeId: PRIZE_ID,
			numberValue: '9999',
			notes: ''
		});
		expect(result).toMatchObject({
			success: true,
			result: { resultStatus: 'no_match', reasonLabel: 'El número no está en el padrón' }
		});
	});

	it('returns the real-shaped frozen result immediately after loading', async () => {
		const loadedPrize = {
			...prize,
			winningNumber: {
				id: 'w',
				numberValue: 7,
				resultStatus: 'not_eligible',
				notes: null,
				loadedAt: '2026-11-20T02:30:00+00:00',
				matchedRosterEntryId: 'entry',
				eligible: false,
				ineligibilityReason: 'not_fully_paid',
				bondId: 'bond',
				bondLabel: 'B-7',
				buyerLabel: 'Fire Supplies SA',
				collectorLabel: 'Central station'
			}
		};
		vi.mocked(getPrizeInDraw)
			.mockResolvedValueOnce({ data: prize, error: null } as never)
			.mockResolvedValueOnce({ data: loadedPrize, error: null } as never);
		const result = await run('loadWinner', ['campaign.view', 'draw.load_winner'], {
			prizeId: PRIZE_ID,
			numberValue: '7',
			notes: ''
		});
		expect(result).toMatchObject({
			success: true,
			result: {
				formattedNumber: '0007',
				buyerLabel: 'Fire Supplies SA',
				collectorLabel: 'Central station',
				reasonLabel: 'Bono sin pago total'
			}
		});
		expect(loadWinningNumber).toHaveBeenCalledWith(
			expect.anything(),
			{ prizeId: PRIZE_ID, numberValue: 7, notes: null },
			{ requestId: 'req-test', permissions: ['campaign.view', 'draw.load_winner'] }
		);
	});

	it.each([
		['loadWinner', loadWinningNumber, 'Este premio ya tiene un número ganador cargado.'],
		['annul', annulPrize, 'A delivered prize cannot be annulled.'],
		['create', createPrize, 'Previous prizes must be resolved before consolation.']
	] as const)('maps the %s conflict to 409', async (action, service, message) => {
		vi.mocked(service).mockRejectedValueOnce(new PrizeServiceError('conflict', message));
		const fields: Record<string, string> =
			action === 'loadWinner'
				? { prizeId: PRIZE_ID, numberValue: '7' }
				: action === 'annul'
					? { prizeId: PRIZE_ID, reason: 'Wrong result' }
					: { name: 'Bike', position: '1', excludesFromConsolation: 'on' };
		const permission =
			action === 'loadWinner'
				? 'draw.load_winner'
				: action === 'annul'
					? 'prize.annul'
					: 'draw.update';
		expect(await run(action, ['campaign.view', permission], fields)).toMatchObject({
			status: 409
		});
	});
});

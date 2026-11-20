import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
	createPrize,
	updatePrize,
	loadWinningNumber,
	resolvePrize,
	deliverPrize,
	annulPrize,
	createPrizeSchema,
	updatePrizeSchema,
	loadWinningNumberSchema,
	resolvePrizeSchema,
	deliverPrizeSchema,
	annulPrizeSchema,
	type PrizeRequestContext
} from './prizes';

const id = 'a6420000-0000-4000-8000-000000000001';
const fields = { name: 'Prize', description: null, position: 1, excludesFromConsolation: true };
const cases = [
	[
		'create',
		(db: SupabaseClient, ctx: PrizeRequestContext) =>
			createPrize(db, { drawId: id, ...fields }, ctx),
		'draw.update',
		'prize_create',
		{
			p_draw_id: id,
			p_name: 'Prize',
			p_description: null,
			p_position: 1,
			p_excludes_from_consolation: true
		}
	],
	[
		'update',
		(db: SupabaseClient, ctx: PrizeRequestContext) =>
			updatePrize(db, { prizeId: id, ...fields }, ctx),
		'draw.update',
		'prize_update',
		{
			p_prize_id: id,
			p_name: 'Prize',
			p_description: null,
			p_position: 1,
			p_excludes_from_consolation: true
		}
	],
	[
		'load',
		(db: SupabaseClient, ctx: PrizeRequestContext) =>
			loadWinningNumber(db, { prizeId: id, numberValue: 0, notes: null }, ctx),
		'draw.load_winner',
		'draw_load_winning_number',
		{ p_prize_id: id, p_number_value: 0, p_notes: null }
	],
	[
		'resolve',
		(db: SupabaseClient, ctx: PrizeRequestContext) =>
			resolvePrize(db, { prizeId: id, decision: 'award', notes: null }, ctx),
		'prize.resolve',
		'prize_resolve',
		{ p_prize_id: id, p_decision: 'award', p_notes: null }
	],
	[
		'deliver',
		(db: SupabaseClient, ctx: PrizeRequestContext) =>
			deliverPrize(db, { prizeId: id, notes: ' Delivered ' }, ctx),
		'prize.deliver',
		'prize_deliver',
		{ p_prize_id: id, p_notes: 'Delivered' }
	],
	[
		'annul',
		(db: SupabaseClient, ctx: PrizeRequestContext) =>
			annulPrize(db, { prizeId: id, reason: ' Wrong result ' }, ctx),
		'prize.resolve',
		'prize_annul',
		{ p_prize_id: id, p_reason: 'Wrong result' }
	]
] as const;

describe.each(cases)('%s prize', (action, run, permission, name, args) => {
	it('fails closed without any DB call', async () => {
		const rpc = vi.fn();
		const db = { rpc } as unknown as SupabaseClient;
		await expect(run(db, { requestId: 'unknown', permissions: null })).rejects.toMatchObject({
			status: 500
		});
		await expect(run(db, { requestId: 'denied', permissions: [] })).rejects.toMatchObject({
			status: 403
		});
		expect(rpc).not.toHaveBeenCalled();
	});
	it('calls the exact RPC and context', async () => {
		const rpc = vi.fn().mockResolvedValue({ data: id, error: null });
		await expect(
			run({ rpc } as unknown as SupabaseClient, { requestId: 'req', permissions: [permission] })
		).resolves.toBe(['create', 'load'].includes(action) ? id : undefined);
		expect(rpc).toHaveBeenCalledExactlyOnceWith(name, { ...args, p_request_id: 'req' });
	});
	it.each([
		['42501', 403],
		['55000', 409],
		['22023', 400],
		['P0002', 404],
		['23505', 409],
		['23514', 400],
		['unknown', 500]
	])('maps %s', async (code, status) => {
		const rpc = vi.fn().mockResolvedValue({ error: { code } });
		await expect(
			run({ rpc } as unknown as SupabaseClient, { requestId: 'err', permissions: [permission] })
		).rejects.toMatchObject({ status });
	});
	it('maps network errors', async () => {
		const rpc = vi.fn().mockRejectedValue(new Error('network'));
		await expect(
			run({ rpc } as unknown as SupabaseClient, { requestId: null, permissions: [permission] })
		).rejects.toMatchObject({ status: 500 });
	});
});
describe('prize validation', () => {
	it('matches DB code-point limits, trimming and optional nulls', () => {
		expect(
			createPrizeSchema.parse({ drawId: id, ...fields, name: ` ${'🧯'.repeat(200)} ` }).name
		).toBe('🧯'.repeat(200));
		expect(
			createPrizeSchema.safeParse({ drawId: id, ...fields, name: '🧯'.repeat(201) }).success
		).toBe(false);
		for (const value of [null, '🧯'.repeat(1000)])
			expect(
				createPrizeSchema.safeParse({ drawId: id, ...fields, description: value }).success
			).toBe(true);
		for (const value of ['', ' ', '🧯'.repeat(1001)])
			expect(
				createPrizeSchema.safeParse({ drawId: id, ...fields, description: value }).success
			).toBe(false);
		expect(deliverPrizeSchema.safeParse({ prizeId: id, notes: '🧯'.repeat(1000) }).success).toBe(
			true
		);
		expect(annulPrizeSchema.safeParse({ prizeId: id, reason: '🧯'.repeat(1000) }).success).toBe(
			true
		);
		for (const value of ['', ' ', '🧯'.repeat(1001)]) {
			expect(deliverPrizeSchema.safeParse({ prizeId: id, notes: value }).success).toBe(false);
			expect(annulPrizeSchema.safeParse({ prizeId: id, reason: value }).success).toBe(false);
		}
	});
	it('validates identifiers, integer range and decision', () => {
		expect(updatePrizeSchema.safeParse({ prizeId: 'bad', ...fields }).success).toBe(false);
		for (const position of [0, -1, 1.5, 2147483648])
			expect(createPrizeSchema.safeParse({ drawId: id, ...fields, position }).success).toBe(false);
		for (const numberValue of [-1, 1.5, NaN, 2147483648])
			expect(
				loadWinningNumberSchema.safeParse({ prizeId: id, numberValue, notes: null }).success
			).toBe(false);
		expect(
			resolvePrizeSchema.safeParse({ prizeId: id, decision: 'override', notes: null }).success
		).toBe(false);
	});
	it('rejects invalid input before a DB call for every entry point', async () => {
		const rpc = vi.fn();
		const db = { rpc } as unknown as SupabaseClient;
		const ctx = {
			permissions: ['draw.update', 'draw.load_winner', 'prize.resolve', 'prize.deliver'],
			requestId: 'invalid'
		};
		for (const run of [
			() => createPrize(db, { drawId: id, ...fields, name: '' }, ctx),
			() => updatePrize(db, { prizeId: id, ...fields, position: 0 }, ctx),
			() => loadWinningNumber(db, { prizeId: id, numberValue: -1, notes: null }, ctx),
			() => resolvePrize(db, { prizeId: id, decision: 'award', notes: '' }, ctx),
			() => deliverPrize(db, { prizeId: id, notes: '' }, ctx),
			() => annulPrize(db, { prizeId: id, reason: '' }, ctx)
		])
			await expect(run()).rejects.toMatchObject({ status: 400 });
		expect(rpc).not.toHaveBeenCalled();
	});
});

import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
	createDraw,
	updateDraw,
	annulDraw,
	createDrawSchema,
	updateDrawSchema,
	annulDrawSchema
} from './draws';
const id = 'a6380000-0000-4000-8000-000000000001';
const fields = {
	name: 'Monthly',
	drawDate: '2026-12-01',
	paymentCutoffAt: '2026-12-01T23:59:59-03:00',
	requiredInstallmentNumber: 1,
	eligibilityRule: {}
};
const create = { campaignId: id, drawType: 'monthly' as const, ...fields };
const update = { drawId: id, ...fields };
describe('draw write schemas', () => {
	it('rejects invalid writes without a database call', async () => {
		const rpc = vi.fn();
		const db = { rpc } as unknown as SupabaseClient;
		const ctx = { permissions: ['draw.create', 'draw.update'], requestId: 'invalid' };
		await expect(createDraw(db, { ...create, name: ' ' }, ctx)).rejects.toMatchObject({
			status: 400
		});
		await expect(updateDraw(db, { ...update, drawId: 'bad' }, ctx)).rejects.toMatchObject({
			status: 400
		});
		await expect(annulDraw(db, { drawId: id, reason: ' ' }, ctx)).rejects.toMatchObject({
			status: 400
		});
		expect(rpc).not.toHaveBeenCalled();
	});
	it('counts name and reason limits in Unicode code points and trims', () => {
		expect(createDrawSchema.parse({ ...create, name: ` ${'🧯'.repeat(200)} ` }).name).toBe(
			'🧯'.repeat(200)
		);
		expect(createDrawSchema.safeParse({ ...create, name: '🧯'.repeat(201) }).success).toBe(false);
		expect(annulDrawSchema.parse({ drawId: id, reason: '🧯'.repeat(1000) }).reason).toHaveLength(
			2000
		);
		expect(annulDrawSchema.safeParse({ drawId: id, reason: '🧯'.repeat(1001) }).success).toBe(
			false
		);
	});
	it('requires monthly installment, object rule, valid dates and nonblank text', () => {
		for (const change of [
			{ requiredInstallmentNumber: null },
			{ requiredInstallmentNumber: 0 },
			{ eligibilityRule: [] },
			{ name: ' ' },
			{ drawDate: '2026-02-30' },
			{ paymentCutoffAt: 'bad' }
		]) {
			expect(createDrawSchema.safeParse({ ...create, ...change }).success).toBe(false);
		}
		expect(
			createDrawSchema.safeParse({
				...create,
				drawType: 'consolation',
				requiredInstallmentNumber: null
			}).success
		).toBe(true);
		expect(updateDrawSchema.safeParse({ ...update, requiredInstallmentNumber: null }).success).toBe(
			true
		);
	});
});
describe.each([
	[
		'create',
		(db: SupabaseClient, ctx: Parameters<typeof createDraw>[2]) => createDraw(db, create, ctx),
		'draw.create',
		'draw_create'
	],
	[
		'update',
		(db: SupabaseClient, ctx: Parameters<typeof updateDraw>[2]) => updateDraw(db, update, ctx),
		'draw.update',
		'draw_update'
	],
	[
		'annul',
		(db: SupabaseClient, ctx: Parameters<typeof annulDraw>[2]) =>
			annulDraw(db, { drawId: id, reason: 'Reason' }, ctx),
		'draw.update',
		'draw_annul'
	]
] as const)('%s draw', (action, run, permission, rpcName) => {
	it('fails closed before any DB call', async () => {
		const rpc = vi.fn();
		const db = { rpc } as unknown as SupabaseClient;
		await expect(run(db, { permissions: null, requestId: 'unknown' })).rejects.toMatchObject({
			status: 500
		});
		await expect(run(db, { permissions: [], requestId: 'denied' })).rejects.toMatchObject({
			status: 403
		});
		expect(rpc).not.toHaveBeenCalled();
	});
	it('calls the exact RPC, passing request context', async () => {
		const rpc = vi.fn().mockResolvedValue({ data: action === 'create' ? id : null, error: null });
		await expect(
			run({ rpc } as unknown as SupabaseClient, { permissions: [permission], requestId: 'request' })
		).resolves.toBe(action === 'create' ? id : undefined);
		expect(rpc).toHaveBeenCalledExactlyOnceWith(
			rpcName,
			expect.objectContaining({ p_request_id: 'request' })
		);
	});
	it.each([
		['42501', 403],
		['55000', 409],
		['22023', 400],
		['23514', 400],
		['P0002', 404],
		['unknown', 500]
	])('maps %s explicitly', async (code, status) => {
		const rpc = vi.fn().mockResolvedValue({ error: { code } });
		await expect(
			run({ rpc } as unknown as SupabaseClient, { permissions: [permission], requestId: 'error' })
		).rejects.toMatchObject({ status });
	});
	it('handles transport failures', async () => {
		const rpc = vi.fn().mockRejectedValue(new Error('network'));
		await expect(
			run({ rpc } as unknown as SupabaseClient, { permissions: [permission], requestId: 'error' })
		).rejects.toMatchObject({ status: 500 });
	});
});

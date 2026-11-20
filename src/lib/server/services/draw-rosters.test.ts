import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { generateDrawRoster, freezeDrawRoster, mapDrawRosterRpcError } from './draw-rosters';

const drawId = 'a6380000-0000-4000-8000-000000000001';
describe.each([
	['generate', generateDrawRoster],
	['freeze', freezeDrawRoster]
] as const)('%s draw roster', (action, run) => {
	const client = (rpc = vi.fn().mockResolvedValue({ data: drawId, error: null })) => ({
		rpc,
		db: { rpc } as unknown as SupabaseClient
	});
	it('fails closed before DB calls, even with invalid input', async () => {
		const { db, rpc } = client();
		await expect(
			run(db, { drawId: 'bad' }, { requestId: 'denied', permissions: null })
		).rejects.toMatchObject({ status: 500 });
		await expect(
			run(db, { drawId }, { requestId: 'denied', permissions: [] })
		).rejects.toMatchObject({ status: 403 });
		expect(rpc).not.toHaveBeenCalled();
	});
	it('validates the draw id before calling the RPC', async () => {
		const { db, rpc } = client();
		await expect(
			run(db, { drawId: 'bad' }, { requestId: 'invalid', permissions: [`draw.${action}_roster`] })
		).rejects.toMatchObject({ status: 400 });
		expect(rpc).not.toHaveBeenCalled();
	});
	it('passes only trusted RPC identifiers and context', async () => {
		const { db, rpc } = client();
		await expect(
			run(db, { drawId }, { requestId: 'request', permissions: [`draw.${action}_roster`] })
		).resolves.toBe(action === 'generate' ? drawId : undefined);
		expect(rpc).toHaveBeenCalledExactlyOnceWith(`draw_${action}_roster`, {
			p_draw_id: drawId,
			p_request_id: 'request'
		});
	});
	it.each([
		['42501', 403],
		['55000', 409],
		['22023', 400],
		['23514', 400],
		['P0002', 404],
		['unknown', 500]
	])('maps %s to %s', async (code, status) => {
		const { db } = client(vi.fn().mockResolvedValue({ data: null, error: { code } }));
		await expect(
			run(db, { drawId }, { requestId: null, permissions: [`draw.${action}_roster`] })
		).rejects.toMatchObject({ status });
		expect(mapDrawRosterRpcError({ code }).status).toBe(status);
	});
	it('maps transport failure to internal error', async () => {
		const { db } = client(vi.fn().mockRejectedValue(new Error('network')));
		await expect(
			run(db, { drawId }, { requestId: null, permissions: [`draw.${action}_roster`] })
		).rejects.toMatchObject({ status: 500 });
	});
});

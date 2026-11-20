import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { hasPermissionIn } from '$lib/server/auth/permissions';
import { DrawServiceError, mapDrawRpcError, type DrawRequestContext } from './draws';

const inputSchema = z.object({ drawId: z.guid() });

async function run(
	client: SupabaseClient,
	name: 'draw_generate_roster' | 'draw_freeze_roster',
	input: { drawId: string },
	ctx: DrawRequestContext,
	permission: 'draw.generate_roster' | 'draw.freeze_roster'
) {
	const parsed = inputSchema.safeParse(input);
	if (!parsed.success)
		throw new DrawServiceError('validation', 'Invalid draw data.', { cause: parsed.error });
	if (ctx.permissions == null)
		throw new DrawServiceError('internal', 'Something went wrong. Please try again.');
	if (!hasPermissionIn(ctx.permissions, permission))
		throw new DrawServiceError('permission', 'You do not have permission to perform this action.');
	try {
		const { data, error } = await client.rpc(name, {
			p_draw_id: parsed.data.drawId,
			p_request_id: ctx.requestId ?? null
		});
		if (error) throw mapDrawRpcError(error);
		return data as string;
	} catch (error) {
		if (error instanceof DrawServiceError) throw error;
		throw new DrawServiceError('internal', 'Something went wrong. Please try again.', {
			cause: error
		});
	}
}

export const generateDrawRoster = (
	client: SupabaseClient,
	input: { drawId: string },
	ctx: DrawRequestContext
) => run(client, 'draw_generate_roster', input, ctx, 'draw.generate_roster');

export const freezeDrawRoster = (
	client: SupabaseClient,
	input: { drawId: string },
	ctx: DrawRequestContext
) => run(client, 'draw_freeze_roster', input, ctx, 'draw.freeze_roster');

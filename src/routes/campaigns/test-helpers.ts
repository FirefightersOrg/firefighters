// Test-only helpers for the /campaigns route tests (not a route file: no `+` prefix).
import { vi } from 'vitest';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { UserProfile } from '../../app';
import type { CampaignRow } from '$lib/server/repositories/campaigns';

export const CAMPAIGN_ID = 'f0000000-0000-0000-0000-000000000001';

export const ADMIN_PERMISSIONS = [
	'campaign.view',
	'campaign.create',
	'campaign.update',
	'campaign.update_rules',
	'campaign.close'
];

export const profile: UserProfile = {
	id: 'e0000000-0000-0000-0000-000000000001',
	auth_user_id: 'd0000000-0000-0000-0000-000000000001',
	full_name: 'Admin',
	email: 'admin@firefighters.local',
	status: 'active',
	created_at: '2026-11-16T00:00:00Z'
};

export function campaignRow(overrides: Partial<CampaignRow> = {}): CampaignRow {
	return {
		id: CAMPAIGN_ID,
		name: 'Campaign 2027',
		status: 'draft',
		starts_at: null,
		ends_at: null,
		simple_bond_value: '60000.00',
		installment_count: 10,
		installment_value: '6000.00',
		number_digits: 4,
		max_number: 9999,
		associated_number_offset: 4871,
		overflow_policy: 'reject',
		barcode_mode: 'base_number',
		created_by: profile.id,
		created_at: '2026-11-16T12:00:00+00:00',
		updated_at: '2026-11-16T12:00:00+00:00',
		...overrides
	};
}

type QueryResult = { data: unknown; error: unknown };

/**
 * Minimal Supabase mock: `from('campaigns')` select chains resolve to `query`, `rpc()` resolves
 * to `rpc` (both overridable per test through the returned spies).
 */
export function mockSupabase(options: { query?: QueryResult; rpc?: QueryResult } = {}) {
	const query = options.query ?? { data: null, error: null };
	const overrideTypes = vi.fn().mockResolvedValue(query);
	const chain = {
		select: vi.fn(),
		order: vi.fn(),
		eq: vi.fn(),
		maybeSingle: vi.fn(),
		overrideTypes
	};
	chain.select.mockReturnValue(chain);
	chain.order.mockReturnValue(chain);
	chain.eq.mockReturnValue(chain);
	chain.maybeSingle.mockReturnValue(chain);
	const from = vi.fn().mockReturnValue(chain);
	const rpc = vi.fn().mockResolvedValue(options.rpc ?? { data: null, error: null });
	return { supabase: { from, rpc } as unknown as SupabaseClient, from, rpc, chain };
}

export function makeLocals(options: {
	signedIn?: boolean;
	permissions?: string[];
	supabase?: SupabaseClient;
}): App.Locals {
	const signedIn = options.signedIn ?? true;
	return {
		supabase: options.supabase ?? mockSupabase().supabase,
		safeGetSession: vi.fn(),
		session: null,
		user: signedIn ? ({ id: profile.auth_user_id } as User) : null,
		profile: signedIn ? profile : null,
		permissions: signedIn ? (options.permissions ?? ADMIN_PERMISSIONS) : [],
		requestId: 'req-test'
	};
}

export function postRequest(url: string, fields: Record<string, string>): Request {
	const body = new FormData();
	for (const [key, value] of Object.entries(fields)) body.set(key, value);
	return new Request(url, { method: 'POST', body });
}

/** `fail()` result shape. */
export type ActionFailure = { status: number; data: Record<string, unknown> };

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
		barcode_pattern: null,
		created_by: profile.id,
		created_at: '2026-11-16T12:00:00+00:00',
		updated_at: '2026-11-16T12:00:00+00:00',
		...overrides
	};
}

type QueryResult = { data: unknown; error: unknown };

/**
 * Minimal Supabase mock: `from(table)` select chains resolve to `tables[table]` when given, else
 * to `query`; `rpc()` resolves to `rpc` (all overridable per test through the returned spies).
 * `chain` is the chain of the last `from()` call.
 */
export function mockSupabase(
	options: { query?: QueryResult; rpc?: QueryResult; tables?: Record<string, QueryResult> } = {}
) {
	const query = options.query ?? { data: null, error: null };
	const makeChain = (result: QueryResult) => {
		const chain = {
			select: vi.fn(),
			order: vi.fn(),
			eq: vi.fn(),
			limit: vi.fn(),
			maybeSingle: vi.fn(),
			is: vi.fn(),
			gte: vi.fn(),
			in: vi.fn(),
			or: vi.fn(),
			range: vi.fn(),
			contains: vi.fn(),
			overrideTypes: vi.fn().mockResolvedValue(result)
		};
		for (const method of [
			'select',
			'order',
			'eq',
			'limit',
			'maybeSingle',
			'is',
			'gte',
			'in',
			'or',
			'range',
			'contains'
		] as const) {
			chain[method].mockReturnValue(chain);
		}
		return chain;
	};
	let chain = makeChain(query);
	/** Every chain created, per table (in call order). */
	const chains: Record<string, ReturnType<typeof makeChain>[]> = {};
	const from = vi.fn((table: string) => {
		chain = makeChain(options.tables?.[table] ?? query);
		(chains[table] ??= []).push(chain);
		return chain;
	});
	const rpc = vi.fn().mockResolvedValue(options.rpc ?? { data: null, error: null });
	return {
		supabase: { from, rpc } as unknown as SupabaseClient,
		from,
		rpc,
		chains,
		get chain() {
			return chain;
		}
	};
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

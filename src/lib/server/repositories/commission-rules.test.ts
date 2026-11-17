import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	COMMISSION_RULE_COLUMNS,
	getCommissionRuleById,
	listGeneralCommissionRules,
	mapCommissionRuleRow,
	type CommissionRuleRow
} from './commission-rules';

const CAMPAIGN_ID = 'f0000000-0000-0000-0000-000000000001';

function row(overrides: Partial<CommissionRuleRow> = {}): CommissionRuleRow {
	return {
		id: 'a0000000-0000-0000-0000-000000000001',
		campaign_id: CAMPAIGN_ID,
		rule_type: 'cash_full_payment',
		installment_number: null,
		percentage: '12.5',
		fixed_amount: null,
		applies_to_collector_id: null,
		valid_from: '2026-01-01',
		valid_to: null,
		status: 'active',
		annulled_at: null,
		annulled_by: null,
		annul_reason: null,
		created_by: null,
		created_at: '2026-11-16T12:00:00+00:00',
		updated_at: '2026-11-16T12:00:00+00:00',
		...overrides
	};
}

function client(result: { data: unknown; error: unknown }) {
	const chain = {
		select: vi.fn(),
		eq: vi.fn(),
		is: vi.fn(),
		order: vi.fn(),
		maybeSingle: vi.fn(),
		overrideTypes: vi.fn().mockResolvedValue(result)
	};
	for (const key of ['select', 'eq', 'is', 'order', 'maybeSingle'] as const) {
		chain[key].mockReturnValue(chain);
	}
	const from = vi.fn().mockReturnValue(chain);
	return { supabase: { from } as unknown as SupabaseClient, from, chain };
}

describe('commission rules repository', () => {
	it('selects numeric columns as text so values stay exact', () => {
		expect(COMMISSION_RULE_COLUMNS).toContain('percentage::text');
		expect(COMMISSION_RULE_COLUMNS).toContain('fixed_amount::text');
	});

	it('maps a row to canonical two-decimal strings', () => {
		expect(mapCommissionRuleRow(row())).toMatchObject({
			ruleType: 'cash_full_payment',
			percentage: '12.50',
			fixedAmount: null,
			validFrom: '2026-01-01',
			validTo: null,
			status: 'active'
		});
		expect(mapCommissionRuleRow(row({ percentage: null, fixed_amount: 1500 })).fixedAmount).toBe(
			'1500.00'
		);
	});

	it('throws on unknown enum values', () => {
		expect(() => mapCommissionRuleRow(row({ rule_type: 'bonus' }))).toThrow(/rule_type/);
		expect(() => mapCommissionRuleRow(row({ status: 'deleted' }))).toThrow(/status/);
	});

	it('lists the general rules of one campaign, sorted for display', async () => {
		const { supabase, from, chain } = client({
			data: [
				row({ id: 'annulled', status: 'annulled', annulled_at: 'x', annul_reason: 'r' }),
				row({ id: 'last', rule_type: 'installment_last' }),
				row({ id: 'cash' })
			],
			error: null
		});
		const result = await listGeneralCommissionRules(supabase, CAMPAIGN_ID);
		expect(from).toHaveBeenCalledWith('commission_rules');
		expect(chain.eq).toHaveBeenCalledWith('campaign_id', CAMPAIGN_ID);
		expect(chain.is).toHaveBeenCalledWith('applies_to_collector_id', null);
		expect(result.data?.map((r) => r.id)).toEqual(['cash', 'last', 'annulled']);
	});

	it('returns query and mapping errors', async () => {
		const failing = client({ data: null, error: { message: 'boom' } });
		expect((await listGeneralCommissionRules(failing.supabase, CAMPAIGN_ID)).error).toEqual({
			message: 'boom'
		});
		const bad = client({ data: [row({ rule_type: 'bonus' })], error: null });
		expect((await listGeneralCommissionRules(bad.supabase, CAMPAIGN_ID)).error).toBeInstanceOf(
			Error
		);
	});

	it('gets one rule by id (null when not visible)', async () => {
		const found = client({ data: row(), error: null });
		expect((await getCommissionRuleById(found.supabase, 'id')).data?.percentage).toBe('12.50');
		const missing = client({ data: null, error: null });
		expect(await getCommissionRuleById(missing.supabase, 'id')).toEqual({
			data: null,
			error: null
		});
	});
});

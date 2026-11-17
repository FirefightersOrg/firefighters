import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { actions, load } from './+page.server';
import {
	ADMIN_PERMISSIONS,
	CAMPAIGN_ID,
	campaignRow,
	makeLocals,
	postRequest,
	type ActionFailure
} from '../../test-helpers';
import type { CommissionRuleRow } from '$lib/server/repositories/commission-rules';

const RULE_ID = 'a0000000-0000-0000-0000-000000000001';
/** The rule's updated_at as loaded (hidden `expectedUpdatedAt` field of the edit form). */
const VERSION = '2026-11-16T12:00:00.123456+00:00';
const OTHER_CAMPAIGN = 'f0000000-0000-0000-0000-000000000099';
const PAGE_URL = `http://localhost:5173/campaigns/${CAMPAIGN_ID}/commissions`;
const MANAGER = [...ADMIN_PERMISSIONS, 'commission.view', 'commission.rule_manage'];
const VIEWER = ['campaign.view', 'commission.view'];

type QueryResult = { data: unknown; error: unknown };

function ruleRow(overrides: Partial<CommissionRuleRow> = {}): CommissionRuleRow {
	return {
		id: RULE_ID,
		campaign_id: CAMPAIGN_ID,
		rule_type: 'cash_full_payment',
		installment_number: null,
		percentage: '25.00',
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

/** Supabase mock: one result per table (list and single queries share it), plus rpc(). */
function mockDb(
	options: {
		campaign?: QueryResult;
		rules?: QueryResult;
		rule?: QueryResult;
		rpc?: QueryResult;
	} = {}
) {
	const campaign = options.campaign ?? { data: campaignRow(), error: null };
	const rules = options.rules ?? { data: [ruleRow()], error: null };
	const rule = options.rule ?? { data: ruleRow(), error: null };
	const from = vi.fn((table: string) => {
		let single = false;
		const chain: Record<string, unknown> = {};
		for (const key of ['select', 'eq', 'is', 'order']) chain[key] = vi.fn(() => chain);
		chain.maybeSingle = vi.fn(() => {
			single = true;
			return chain;
		});
		chain.overrideTypes = vi.fn(() =>
			Promise.resolve(table === 'campaigns' ? campaign : single ? rule : rules)
		);
		return chain;
	});
	const rpc = vi.fn().mockResolvedValue(options.rpc ?? { data: null, error: null });
	return { supabase: { from, rpc } as unknown as SupabaseClient, from, rpc };
}

function loadEvent(locals: App.Locals, query = '', id = CAMPAIGN_ID) {
	return {
		locals,
		params: { id },
		url: new URL(`http://localhost:5173/campaigns/${id}/commissions${query}`)
	} as unknown as Parameters<typeof load>[0];
}

type ActionName = keyof typeof actions;
type ActionEvent = Parameters<(typeof actions)['create']>[0];

function runAction(
	name: ActionName,
	locals: App.Locals,
	fields: Record<string, string>,
	id = CAMPAIGN_ID
) {
	const event = {
		locals,
		params: { id },
		url: new URL(`${PAGE_URL}?/${name}`),
		request: postRequest(PAGE_URL, fields)
	} as unknown as ActionEvent;
	return actions[name](event) as Promise<unknown>;
}

const ruleForm = {
	ruleType: 'cash_full_payment',
	installmentNumber: '',
	valueKind: 'percentage',
	percentage: '25',
	fixedAmount: '',
	validFrom: '2026-01-01',
	validTo: '',
	reason: ''
};

describe('/campaigns/[id]/commissions', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	describe('load', () => {
		it('requires commission.view (403)', async () => {
			const { supabase } = mockDb();
			await expect(
				load(loadEvent(makeLocals({ supabase, permissions: ['campaign.view'] })))
			).rejects.toMatchObject({ status: 403 });
		});

		it('requires campaign.view (403)', async () => {
			const { supabase } = mockDb();
			await expect(
				load(loadEvent(makeLocals({ supabase, permissions: ['commission.view'] })))
			).rejects.toMatchObject({ status: 403 });
		});

		it('redirects anonymous users to login', async () => {
			await expect(load(loadEvent(makeLocals({ signedIn: false })))).rejects.toMatchObject({
				status: 303
			});
		});

		it('returns 404 for a malformed or unknown campaign', async () => {
			const { supabase, from } = mockDb();
			await expect(
				load(loadEvent(makeLocals({ supabase, permissions: VIEWER }), '', 'nope'))
			).rejects.toMatchObject({ status: 404 });
			expect(from).not.toHaveBeenCalled();
			const missing = mockDb({ campaign: { data: null, error: null } });
			await expect(
				load(loadEvent(makeLocals({ supabase: missing.supabase, permissions: VIEWER })))
			).rejects.toMatchObject({ status: 404 });
		});

		it('returns 500 when a query fails', async () => {
			const { supabase } = mockDb({ rules: { data: null, error: { message: 'boom' } } });
			await expect(
				load(loadEvent(makeLocals({ supabase, permissions: VIEWER })))
			).rejects.toMatchObject({ status: 500 });
		});

		it('lists the rules read-only for a viewer', async () => {
			const { supabase } = mockDb();
			const data = (await load(
				loadEvent(makeLocals({ supabase, permissions: VIEWER }), `?edit=${RULE_ID}`)
			)) as Record<string, unknown>;
			expect(data).toMatchObject({
				can: { manage: false },
				editRuleId: null,
				editNotFound: false
			});
			expect((data.rules as { percentage: string }[])[0].percentage).toBe('25.00');
		});

		it('lets a manager edit an active rule of a draft or active campaign', async () => {
			const { supabase } = mockDb();
			const data = (await load(
				loadEvent(makeLocals({ supabase, permissions: MANAGER }), `?edit=${RULE_ID}`)
			)) as Record<string, unknown>;
			expect(data).toMatchObject({ can: { manage: true }, editRuleId: RULE_ID });

			const unknown = (await load(
				loadEvent(makeLocals({ supabase, permissions: MANAGER }), `?edit=${OTHER_CAMPAIGN}`)
			)) as Record<string, unknown>;
			expect(unknown).toMatchObject({ editRuleId: null, editNotFound: true });
		});

		it('is read-only once the campaign is closing', async () => {
			const { supabase } = mockDb({
				campaign: { data: campaignRow({ status: 'closing' }), error: null }
			});
			const data = (await load(loadEvent(makeLocals({ supabase, permissions: MANAGER })))) as {
				can: { manage: boolean };
			};
			expect(data.can.manage).toBe(false);
		});
	});

	describe('actions', () => {
		it.each(['create', 'update', 'annul'] as const)(
			'%s requires commission.rule_manage (403, no RPC)',
			async (name) => {
				const { supabase, rpc } = mockDb();
				const result = (await runAction(name, makeLocals({ supabase, permissions: VIEWER }), {
					...ruleForm,
					ruleId: RULE_ID,
					reason: 'x'
				})) as ActionFailure;
				expect(result.status).toBe(403);
				expect(rpc).not.toHaveBeenCalled();
			}
		);

		it('create: validates against the campaign installment count before calling the database', async () => {
			const { supabase, rpc } = mockDb();
			const result = (await runAction('create', makeLocals({ supabase, permissions: MANAGER }), {
				...ruleForm,
				ruleType: 'custom',
				installmentNumber: '11',
				percentage: '12,345'
			})) as ActionFailure;
			expect(result.status).toBe(400);
			expect(result.data.errors).toEqual({
				installmentNumber: ['Installment number must be between 1 and 10'],
				percentage: [expect.stringContaining('Enter a percentage')]
			});
			expect(result.data.values).toMatchObject({ installmentNumber: '11' });
			expect(rpc).not.toHaveBeenCalled();
		});

		it('create: calls commission_rule_create with canonical values', async () => {
			const { supabase, rpc } = mockDb({ rpc: { data: RULE_ID, error: null } });
			const result = await runAction('create', makeLocals({ supabase, permissions: MANAGER }), {
				...ruleForm,
				valueKind: 'fixed_amount',
				fixedAmount: '1.500,00'
			});
			expect(result).toEqual({
				form: 'create',
				success: true,
				message: 'Rule added.',
				errors: {},
				ruleId: RULE_ID
			});
			expect(rpc).toHaveBeenCalledWith(
				'commission_rule_create',
				expect.objectContaining({
					p_campaign_id: CAMPAIGN_ID,
					p_percentage: null,
					p_fixed_amount: '1500.00',
					p_request_id: 'req-test'
				})
			);
		});

		it('create: an overlapping rule is a friendly 409', async () => {
			const { supabase } = mockDb({
				rpc: {
					data: null,
					error: {
						code: '23P01',
						message:
							'conflicting key value violates exclusion constraint "commission_rules_no_overlap"'
					}
				}
			});
			const result = (await runAction(
				'create',
				makeLocals({ supabase, permissions: MANAGER }),
				ruleForm
			)) as ActionFailure;
			expect(result.status).toBe(409);
			expect(result.data.message).toMatch(/overlaps an existing active rule/);
		});

		it('update: rejects a rule of another campaign (404, no RPC)', async () => {
			const { supabase, rpc } = mockDb({
				rule: { data: ruleRow({ campaign_id: OTHER_CAMPAIGN }), error: null }
			});
			const result = (await runAction('update', makeLocals({ supabase, permissions: MANAGER }), {
				...ruleForm,
				ruleId: RULE_ID,
				expectedUpdatedAt: VERSION
			})) as ActionFailure;
			expect(result.status).toBe(404);
			expect(result.data.ruleId).toBe(RULE_ID);
			expect(rpc).not.toHaveBeenCalled();
		});

		it('update: saves and reports no-ops', async () => {
			const { supabase, rpc } = mockDb({ rpc: { data: false, error: null } });
			const result = await runAction('update', makeLocals({ supabase, permissions: MANAGER }), {
				...ruleForm,
				ruleId: RULE_ID,
				expectedUpdatedAt: VERSION,
				percentage: '12,5'
			});
			expect(result).toMatchObject({
				success: true,
				message: 'No changes to save.',
				ruleId: RULE_ID
			});
			expect(rpc).toHaveBeenCalledWith(
				'commission_rule_update',
				expect.objectContaining({
					p_id: RULE_ID,
					p_percentage: '12.50',
					p_expected_updated_at: VERSION
				})
			);
		});

		it('update: a stale version (someone else saved first) is a 409 asking to reload', async () => {
			const { supabase } = mockDb({
				rpc: {
					data: null,
					error: { code: '40001', message: 'commission rule was modified by someone else' }
				}
			});
			const fields = { ...ruleForm, ruleId: RULE_ID, expectedUpdatedAt: VERSION };
			const result = (await runAction(
				'update',
				makeLocals({ supabase, permissions: MANAGER }),
				fields
			)) as ActionFailure;
			expect(result.status).toBe(409);
			expect(result.data).toMatchObject({
				form: 'update',
				ruleId: RULE_ID,
				message:
					'This commission rule was changed by someone else while you were editing it. Reload the page to see the latest changes, then make your edit again.',
				values: { expectedUpdatedAt: VERSION }
			});
		});

		it('update: a missing version is rejected without calling the database', async () => {
			const { supabase, rpc } = mockDb();
			const result = (await runAction('update', makeLocals({ supabase, permissions: MANAGER }), {
				...ruleForm,
				ruleId: RULE_ID
			})) as ActionFailure;
			expect(result.status).toBe(400);
			expect(result.data).toMatchObject({
				ruleId: RULE_ID,
				message: 'This form is out of date. Reload the page and try again.'
			});
			expect(rpc).not.toHaveBeenCalled();
		});

		it('update: a failed edit keeps the rule id so the edit form stays open without JS', async () => {
			const { supabase } = mockDb();
			const result = (await runAction('update', makeLocals({ supabase, permissions: MANAGER }), {
				...ruleForm,
				ruleId: RULE_ID,
				expectedUpdatedAt: VERSION,
				percentage: '0'
			})) as ActionFailure;
			expect(result.status).toBe(400);
			expect(result.data).toMatchObject({ form: 'update', ruleId: RULE_ID });
		});

		it('annul: requires a reason', async () => {
			const { supabase, rpc } = mockDb();
			const result = (await runAction('annul', makeLocals({ supabase, permissions: MANAGER }), {
				ruleId: RULE_ID,
				reason: '  '
			})) as ActionFailure;
			expect(result.status).toBe(400);
			expect(result.data.errors).toEqual({
				reason: ['A reason is required to annul a commission rule']
			});
			expect(rpc).not.toHaveBeenCalled();
		});

		it('annul: calls commission_rule_annul and maps a double annul to 409', async () => {
			const ok = mockDb();
			expect(
				await runAction('annul', makeLocals({ supabase: ok.supabase, permissions: MANAGER }), {
					ruleId: RULE_ID,
					reason: 'Mistake'
				})
			).toMatchObject({ success: true, message: 'Rule annulled.' });
			expect(ok.rpc).toHaveBeenCalledWith('commission_rule_annul', {
				p_id: RULE_ID,
				p_reason: 'Mistake',
				p_request_id: 'req-test'
			});

			const twice = mockDb({
				rpc: {
					data: null,
					error: { code: '55000', message: `commission rule ${RULE_ID} is already annulled` }
				}
			});
			const result = (await runAction(
				'annul',
				makeLocals({ supabase: twice.supabase, permissions: MANAGER }),
				{ ruleId: RULE_ID, reason: 'Again' }
			)) as ActionFailure;
			expect(result.status).toBe(409);
			expect(result.data.message).toBe('This rule is already annulled.');
		});
	});
});

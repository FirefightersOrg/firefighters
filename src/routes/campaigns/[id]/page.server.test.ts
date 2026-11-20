import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';
import {
	CAMPAIGN_ID,
	campaignRow,
	makeLocals,
	mockSupabase,
	postRequest,
	type ActionFailure
} from '../test-helpers';

const PAGE_URL = `http://localhost:5173/campaigns/${CAMPAIGN_ID}`;

type ActionName = keyof typeof actions;
type ActionEvent = Parameters<(typeof actions)['update']>[0];

function loadEvent(locals: App.Locals, id = CAMPAIGN_ID) {
	return {
		locals,
		params: { id },
		url: new URL(`http://localhost:5173/campaigns/${id}`)
	} as unknown as Parameters<typeof load>[0];
}

function runAction(
	name: ActionName,
	locals: App.Locals,
	fields: Record<string, string>,
	id = CAMPAIGN_ID
) {
	const event = {
		locals,
		params: { id },
		url: new URL(`http://localhost:5173/campaigns/${id}?/${name}`),
		request: postRequest(PAGE_URL, fields)
	} as unknown as ActionEvent;
	return actions[name](event) as Promise<unknown>;
}

/** The campaign's updated_at as loaded (hidden `expectedUpdatedAt` field of the edit forms). */
const VERSION = '2026-11-16T12:00:00.123456+00:00';
const STALE_ERROR = { code: 'PT409', message: 'campaign was modified by someone else' };
const STALE_MESSAGE =
	'This campaign was changed by someone else while you were editing it. Reload the page to see the latest changes, then make your edit again.';

const rulesForm = {
	simpleBondValue: '60.000,00',
	installmentCount: '12',
	numberDigits: '4',
	maxNumber: '9999',
	associatedNumberOffset: '4871',
	overflowPolicy: 'reject',
	barcodeMode: 'internal_code',
	changeReason: '',
	confirmRulesChange: 'yes',
	expectedUpdatedAt: VERSION
};

describe('/campaigns/[id]', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	describe('load', () => {
		it('returns 404 for a malformed id without querying', async () => {
			const { supabase, from } = mockSupabase();
			await expect(load(loadEvent(makeLocals({ supabase }), 'not-a-uuid'))).rejects.toMatchObject({
				status: 404
			});
			expect(from).not.toHaveBeenCalled();
		});

		it('returns 404 when the campaign does not exist or is not visible', async () => {
			const { supabase } = mockSupabase({ query: { data: null, error: null } });
			await expect(load(loadEvent(makeLocals({ supabase })))).rejects.toMatchObject({
				status: 404,
				body: { message: 'Campaign not found.' }
			});
		});

		it('returns 500 when the query fails', async () => {
			const { supabase } = mockSupabase({ query: { data: null, error: { message: 'boom' } } });
			await expect(load(loadEvent(makeLocals({ supabase })))).rejects.toMatchObject({
				status: 500
			});
		});

		it('requires campaign.view and an active user', async () => {
			await expect(load(loadEvent(makeLocals({ permissions: [] })))).rejects.toMatchObject({
				status: 403
			});
			await expect(load(loadEvent(makeLocals({ signedIn: false })))).rejects.toMatchObject({
				status: 303,
				location: `/login?redirectTo=%2Fcampaigns%2F${CAMPAIGN_ID}`
			});
		});

		it('admin on a draft: may edit everything, activate or annul', async () => {
			const { supabase } = mockSupabase({ query: { data: campaignRow(), error: null } });
			const data = (await load(loadEvent(makeLocals({ supabase }))))!;
			expect(data.campaign.id).toBe(CAMPAIGN_ID);
			expect(data.can).toEqual({
				editName: true,
				editDates: true,
				editRules: true,
				transitions: ['active', 'annulled'],
				viewCommissions: false,
				viewAudit: false,
				viewBonds: false,
				loadBonds: false,
				viewCollectors: false,
				viewBuyers: false,
				viewDeliveries: false,
				viewSales: false,
				viewSettlements: false,
				exportBackups: false
			});
		});

		it('admin on an active campaign: rules frozen, may start closing or annul', async () => {
			const { supabase } = mockSupabase({
				query: { data: campaignRow({ status: 'active' }), error: null }
			});
			const data = (await load(loadEvent(makeLocals({ supabase }))))!;
			expect(data.can).toEqual({
				editName: true,
				editDates: true,
				editRules: false,
				transitions: ['closing', 'annulled'],
				viewCommissions: false,
				viewAudit: false,
				viewBonds: false,
				loadBonds: false,
				viewCollectors: false,
				viewBuyers: false,
				viewDeliveries: false,
				viewSales: false,
				viewSettlements: false,
				exportBackups: false
			});
		});

		it('closing campaign: only the name stays editable', async () => {
			const { supabase } = mockSupabase({
				query: { data: campaignRow({ status: 'closing' }), error: null }
			});
			const data = (await load(loadEvent(makeLocals({ supabase }))))!;
			expect(data.can).toEqual({
				editName: true,
				editDates: false,
				editRules: false,
				transitions: ['closed'],
				viewCommissions: false,
				viewAudit: false,
				viewBonds: false,
				loadBonds: false,
				viewCollectors: false,
				viewBuyers: false,
				viewDeliveries: false,
				viewSales: false,
				viewSettlements: false,
				exportBackups: false
			});
		});

		it('links to the commission rules only with commission.view', async () => {
			const { supabase } = mockSupabase({ query: { data: campaignRow(), error: null } });
			const data = (await load(
				loadEvent(makeLocals({ permissions: ['campaign.view', 'commission.view'], supabase }))
			))!;
			expect(data.can.viewCommissions).toBe(true);
		});

		it('links to the bonds list only with bond.view', async () => {
			const { supabase } = mockSupabase({ query: { data: campaignRow(), error: null } });
			const data = (await load(
				loadEvent(makeLocals({ permissions: ['campaign.view', 'bond.view'], supabase }))
			))!;
			expect(data.can.viewBonds).toBe(true);
		});

		it('viewer only (operator): no edit forms and no status actions', async () => {
			const { supabase } = mockSupabase({ query: { data: campaignRow(), error: null } });
			const data = (await load(
				loadEvent(makeLocals({ permissions: ['campaign.view'], supabase }))
			))!;
			expect(data.can).toEqual({
				editName: false,
				editDates: false,
				editRules: false,
				transitions: [],
				viewCommissions: false,
				viewAudit: false,
				viewBonds: false,
				loadBonds: false,
				viewCollectors: false,
				viewBuyers: false,
				viewDeliveries: false,
				viewSales: false,
				viewSettlements: false,
				exportBackups: false
			});
		});

		it('freezes the rules of a draft that already has bonds', async () => {
			const { supabase, from } = mockSupabase({
				tables: {
					campaigns: { data: campaignRow(), error: null },
					bonds: { data: [{ id: 'b1' }], error: null }
				}
			});
			const data = (await load(loadEvent(makeLocals({ supabase }))))!;
			expect(from).toHaveBeenCalledWith('bonds');
			expect(data.hasBonds).toBe(true);
			expect(data.can.editRules).toBe(false);
			// Name and dates stay editable; activating is still possible.
			expect(data.can).toMatchObject({ editName: true, editDates: true });
			expect(data.can.transitions).toEqual(['active', 'annulled']);
		});

		it('keeps the rules editable when the bond lookup fails (the database still guards)', async () => {
			const { supabase } = mockSupabase({
				tables: {
					campaigns: { data: campaignRow(), error: null },
					bonds: { data: null, error: { message: 'boom' } }
				}
			});
			const data = (await load(loadEvent(makeLocals({ supabase }))))!;
			expect(data.hasBonds).toBe(false);
			expect(data.can.editRules).toBe(true);
		});

		it('offers to load bonds with bond.create while the campaign is a draft or active', async () => {
			const permissions = ['campaign.view', 'bond.view', 'bond.create'];
			for (const [status, expected] of [
				['draft', true],
				['active', true],
				['closing', false],
				['closed', false],
				['annulled', false]
			] as const) {
				const { supabase } = mockSupabase({
					tables: { campaigns: { data: campaignRow({ status }), error: null } }
				});
				const data = (await load(loadEvent(makeLocals({ permissions, supabase }))))!;
				expect(data.can.loadBonds, status).toBe(expected);
			}
			const { supabase } = mockSupabase({
				tables: { campaigns: { data: campaignRow(), error: null } }
			});
			const viewer = (await load(
				loadEvent(makeLocals({ permissions: ['campaign.view', 'bond.view'], supabase }))
			))!;
			expect(viewer.can.loadBonds).toBe(false);
		});

		it('campaign.close without campaign.update_rules: may annul a draft but not activate it', async () => {
			const { supabase } = mockSupabase({ query: { data: campaignRow(), error: null } });
			const data = (await load(
				loadEvent(makeLocals({ permissions: ['campaign.view', 'campaign.close'], supabase }))
			))!;
			expect(data.can.transitions).toEqual(['annulled']);
		});
	});

	describe('update action (general data)', () => {
		const fields = {
			name: 'Renamed',
			startsOn: '2027-03-01',
			endsOn: '2027-12-31',
			expectedUpdatedAt: VERSION
		};

		it('returns 403 without campaign.update', async () => {
			const { supabase, rpc } = mockSupabase();
			const result = (await runAction(
				'update',
				makeLocals({ permissions: ['campaign.view', 'campaign.update_rules'], supabase }),
				fields
			)) as ActionFailure;
			expect(result.status).toBe(403);
			expect(result.data.form).toBe('general');
			expect(rpc).not.toHaveBeenCalled();
		});

		it('redirects anonymous users to login', async () => {
			await expect(
				runAction('update', makeLocals({ signedIn: false }), fields)
			).rejects.toMatchObject({
				status: 303,
				location: `/login?redirectTo=%2Fcampaigns%2F${CAMPAIGN_ID}`
			});
		});

		it('saves and reports success, or "no changes"', async () => {
			const { supabase, rpc } = mockSupabase({ rpc: { data: true, error: null } });
			await expect(runAction('update', makeLocals({ supabase }), fields)).resolves.toEqual({
				form: 'general',
				success: true,
				message: 'Changes saved.',
				errors: {}
			});
			expect(rpc).toHaveBeenCalledWith('campaign_update', {
				p_id: CAMPAIGN_ID,
				p_name: 'Renamed',
				p_starts_at: '2027-03-01T00:00:00-03:00',
				p_ends_at: '2027-12-31T23:59:59-03:00',
				p_expected_updated_at: VERSION,
				p_request_id: 'req-test'
			});

			rpc.mockResolvedValueOnce({ data: false, error: null });
			await expect(runAction('update', makeLocals({ supabase }), fields)).resolves.toMatchObject({
				success: true,
				message: 'No changes to save.'
			});
		});

		it('keeps stored timestamps whose day was not changed', async () => {
			const { supabase, rpc } = mockSupabase({
				query: {
					// Set outside the UI: not exactly the start/end of the Argentina day.
					data: campaignRow({
						starts_at: '2027-03-01T15:00:00+00:00',
						ends_at: '2027-12-31T15:00:00+00:00'
					}),
					error: null
				},
				rpc: { data: true, error: null }
			});
			await runAction('update', makeLocals({ supabase }), {
				name: 'Renamed',
				startsOn: '2027-03-01',
				endsOn: '2028-01-15',
				expectedUpdatedAt: VERSION
			});
			expect(rpc).toHaveBeenCalledWith(
				'campaign_update',
				expect.objectContaining({
					p_starts_at: '2027-03-01T15:00:00+00:00',
					p_ends_at: '2028-01-15T23:59:59-03:00'
				})
			);
		});

		it('returns 400 for invalid input', async () => {
			const result = (await runAction('update', makeLocals({}), {
				...fields,
				endsOn: '2027-01-01'
			})) as ActionFailure;
			expect(result.status).toBe(400);
			expect(result.data.errors).toEqual({
				endsOn: ['End date must be on or after the start date']
			});
		});

		it('maps an edit-window violation (closed campaign) to 409', async () => {
			const { supabase } = mockSupabase({
				rpc: {
					data: null,
					error: {
						code: '55000',
						message: 'campaign name cannot be changed once the campaign is closed'
					}
				}
			});
			const result = (await runAction('update', makeLocals({ supabase }), fields)) as ActionFailure;
			expect(result.status).toBe(409);
			expect(result.data.message).toBe(
				'The name of a closed or annulled campaign cannot be changed.'
			);
		});

		it('returns 404 for a malformed id', async () => {
			const result = (await runAction('update', makeLocals({}), fields, 'nope')) as ActionFailure;
			expect(result.status).toBe(404);
		});

		it('maps a stale version (someone else saved first) to 409 and keeps the submitted values', async () => {
			const { supabase, rpc } = mockSupabase({ rpc: { data: null, error: STALE_ERROR } });
			const result = (await runAction('update', makeLocals({ supabase }), fields)) as ActionFailure;
			expect(result.status).toBe(409);
			expect(result.data).toMatchObject({
				form: 'general',
				success: false,
				message: STALE_MESSAGE,
				errors: {},
				values: fields
			});
			expect(rpc).toHaveBeenCalledWith(
				'campaign_update',
				expect.objectContaining({ p_expected_updated_at: VERSION })
			);
		});

		it('rejects a missing or malformed version without calling the database', async () => {
			for (const expectedUpdatedAt of [undefined, '', '2026-11-16']) {
				const { supabase, rpc } = mockSupabase();
				const posted: Record<string, string> = { ...fields };
				if (expectedUpdatedAt === undefined) delete posted.expectedUpdatedAt;
				else posted.expectedUpdatedAt = expectedUpdatedAt;
				const result = (await runAction(
					'update',
					makeLocals({ supabase }),
					posted
				)) as ActionFailure;
				expect(result.status).toBe(400);
				expect(result.data.message).toBe(
					'This form is out of date. Reload the page and try again.'
				);
				expect(rpc).not.toHaveBeenCalled();
			}
		});
	});

	describe('rules action', () => {
		it('returns 403 with campaign.update only', async () => {
			const { supabase, rpc } = mockSupabase();
			const result = (await runAction(
				'rules',
				makeLocals({ permissions: ['campaign.view', 'campaign.update'], supabase }),
				rulesForm
			)) as ActionFailure;
			expect(result.status).toBe(403);
			expect(rpc).not.toHaveBeenCalled();
		});

		it('rejects non-exact installments with a field error', async () => {
			const result = (await runAction('rules', makeLocals({}), {
				...rulesForm,
				installmentCount: '7'
			})) as ActionFailure;
			expect(result.status).toBe(400);
			expect(Object.keys(result.data.errors as object)).toEqual(['installmentCount']);
		});

		it('saves the rules, sending canonical money to SQL', async () => {
			const { supabase, rpc } = mockSupabase({ rpc: { data: true, error: null } });
			await expect(runAction('rules', makeLocals({ supabase }), rulesForm)).resolves.toMatchObject({
				form: 'rules',
				success: true,
				message: 'Rules saved.'
			});
			expect(rpc).toHaveBeenCalledWith('campaign_update_rules', {
				p_id: CAMPAIGN_ID,
				p_simple_bond_value: '60000.00',
				p_installment_count: 12,
				p_number_digits: 4,
				p_max_number: 9999,
				p_associated_number_offset: 4871,
				p_overflow_policy: 'reject',
				p_barcode_mode: 'internal_code',
				p_barcode_pattern: null,
				p_expected_updated_at: VERSION,
				p_request_id: 'req-test',
				p_reason: null
			});
		});

		it('passes the optional reason (trimmed) to the audited SQL function', async () => {
			const { supabase, rpc } = mockSupabase({ rpc: { data: true, error: null } });
			await runAction('rules', makeLocals({ supabase }), {
				...rulesForm,
				changeReason: '  Board meeting 2026-11-16 '
			});
			expect(rpc).toHaveBeenCalledWith(
				'campaign_update_rules',
				expect.objectContaining({
					p_reason: 'Board meeting 2026-11-16',
					p_expected_updated_at: VERSION
				})
			);
		});

		it('rejects a reason longer than 500 characters', async () => {
			const { supabase, rpc } = mockSupabase();
			const result = (await runAction('rules', makeLocals({ supabase }), {
				...rulesForm,
				changeReason: 'x'.repeat(501)
			})) as ActionFailure;
			expect(result.status).toBe(400);
			expect(result.data.errors).toEqual({
				changeReason: ['Reason must be at most 500 characters']
			});
			expect(rpc).not.toHaveBeenCalled();
		});

		it('requires the explicit confirmation and does not call the database without it', async () => {
			const { supabase, rpc } = mockSupabase({ rpc: { data: true, error: null } });
			for (const confirmRulesChange of [undefined, '', 'on']) {
				const fields: Record<string, string> = { ...rulesForm };
				if (confirmRulesChange === undefined) delete fields.confirmRulesChange;
				else fields.confirmRulesChange = confirmRulesChange;
				const result = (await runAction(
					'rules',
					makeLocals({ supabase }),
					fields
				)) as ActionFailure;
				expect(result.status).toBe(400);
				expect(result.data.errors).toEqual({
					confirmRulesChange: ['Confirm that you reviewed the rule changes']
				});
				// Submitted values come back so the form (and its change summary) can be refilled.
				expect(result.data.values).toMatchObject({ simpleBondValue: '60.000,00' });
			}
			expect(rpc).not.toHaveBeenCalled();
		});

		it('rejects malformed money with the format message', async () => {
			const result = (await runAction('rules', makeLocals({}), {
				...rulesForm,
				simpleBondValue: '60,000'
			})) as ActionFailure;
			expect(result.status).toBe(400);
			expect(result.data.errors).toEqual({
				simpleBondValue: [
					'Enter an amount like 60.000 or 60.000,50 (dots for thousands, comma for up to 2 decimals)'
				]
			});
		});

		it('maps a stale version to 409 with a reload message', async () => {
			const { supabase } = mockSupabase({ rpc: { data: null, error: STALE_ERROR } });
			const result = (await runAction(
				'rules',
				makeLocals({ supabase }),
				rulesForm
			)) as ActionFailure;
			expect(result.status).toBe(409);
			expect(result.data).toMatchObject({
				form: 'rules',
				message: STALE_MESSAGE,
				values: { expectedUpdatedAt: VERSION }
			});
		});

		it('requires the version', async () => {
			const { supabase, rpc } = mockSupabase();
			const result = (await runAction('rules', makeLocals({ supabase }), {
				...rulesForm,
				expectedUpdatedAt: ''
			})) as ActionFailure;
			expect(result.status).toBe(400);
			expect(result.data.errors).toHaveProperty('expectedUpdatedAt');
			expect(rpc).not.toHaveBeenCalled();
		});

		it('maps "rules frozen" (campaign no longer draft) to 409', async () => {
			const { supabase } = mockSupabase({
				rpc: {
					data: null,
					error: {
						code: '55000',
						message:
							'campaign rules can only be changed while the campaign is draft (status: active)'
					}
				}
			});
			const result = (await runAction(
				'rules',
				makeLocals({ supabase }),
				rulesForm
			)) as ActionFailure;
			expect(result.status).toBe(409);
			expect(result.data.message).toMatch(/only be changed while the campaign is a draft/);
		});

		it('maps "rules frozen by bonds" (draft with bonds) to 409 with the reason', async () => {
			const { supabase } = mockSupabase({
				rpc: {
					data: null,
					error: {
						code: '55000',
						message: 'campaign rules cannot be changed once the campaign has bonds'
					}
				}
			});
			const result = (await runAction(
				'rules',
				makeLocals({ supabase }),
				rulesForm
			)) as ActionFailure;
			expect(result.status).toBe(409);
			expect(result.data).toMatchObject({
				form: 'rules',
				message:
					'Rules can no longer be changed: this campaign already has bonds, and their numbers and values depend on the rules.'
			});
		});
	});

	describe('transition action', () => {
		it('activation requires campaign.update_rules', async () => {
			const { supabase, rpc } = mockSupabase();
			const result = (await runAction(
				'transition',
				makeLocals({ permissions: ['campaign.view', 'campaign.close'], supabase }),
				{ toStatus: 'active', reason: '' }
			)) as ActionFailure;
			expect(result.status).toBe(403);
			expect(rpc).not.toHaveBeenCalled();
		});

		it.each(['closing', 'closed', 'annulled'])('%s requires campaign.close', async (toStatus) => {
			const { supabase, rpc } = mockSupabase();
			const result = (await runAction(
				'transition',
				makeLocals({ permissions: ['campaign.view', 'campaign.update_rules'], supabase }),
				{ toStatus, reason: 'Because' }
			)) as ActionFailure;
			expect(result.status).toBe(403);
			expect(rpc).not.toHaveBeenCalled();
		});

		it('annul requires a reason', async () => {
			const { supabase, rpc } = mockSupabase();
			const result = (await runAction('transition', makeLocals({ supabase }), {
				toStatus: 'annulled',
				reason: '   '
			})) as ActionFailure;
			expect(result.status).toBe(400);
			expect(result.data.errors).toEqual({ reason: ['A reason is required to annul a campaign'] });
			expect(rpc).not.toHaveBeenCalled();
		});

		it('rejects an unknown target status', async () => {
			const result = (await runAction('transition', makeLocals({}), {
				toStatus: 'draft',
				reason: ''
			})) as ActionFailure;
			expect(result.status).toBe(400);
		});

		it('an unknown target still requires a signed-in viewer', async () => {
			await expect(
				runAction('transition', makeLocals({ signedIn: false }), { toStatus: 'x', reason: '' })
			).rejects.toMatchObject({ status: 303 });
			const result = (await runAction('transition', makeLocals({ permissions: [] }), {
				toStatus: 'x',
				reason: ''
			})) as ActionFailure;
			expect(result.status).toBe(403);
		});

		it('annuls with campaign.close and a reason', async () => {
			const { supabase, rpc } = mockSupabase();
			await expect(
				runAction(
					'transition',
					makeLocals({ permissions: ['campaign.view', 'campaign.close'], supabase }),
					{ toStatus: 'annulled', reason: ' Created by mistake ' }
				)
			).resolves.toEqual({
				form: 'transition',
				success: true,
				message: 'Campaign annulled.',
				errors: {}
			});
			expect(rpc).toHaveBeenCalledWith('campaign_transition', {
				p_id: CAMPAIGN_ID,
				p_to_status: 'annulled',
				p_reason: 'Created by mistake',
				p_request_id: 'req-test'
			});
		});

		it.each([
			['active', 'Campaign activated. Its rules are now frozen.'],
			['closing', 'Campaign moved to closing.'],
			['closed', 'Campaign closed.']
		])('passes an optional reason through for %s', async (toStatus, message) => {
			const { supabase, rpc } = mockSupabase();
			await expect(
				runAction('transition', makeLocals({ supabase }), { toStatus, reason: ' Season over ' })
			).resolves.toEqual({ form: 'transition', success: true, message, errors: {} });
			expect(rpc).toHaveBeenCalledWith('campaign_transition', {
				p_id: CAMPAIGN_ID,
				p_to_status: toStatus,
				p_reason: 'Season over',
				p_request_id: 'req-test'
			});
		});

		it('sends no reason when the optional reason is left empty', async () => {
			const { supabase, rpc } = mockSupabase();
			await runAction('transition', makeLocals({ supabase }), {
				toStatus: 'closing',
				reason: '  '
			});
			expect(rpc).toHaveBeenCalledWith(
				'campaign_transition',
				expect.objectContaining({ p_to_status: 'closing', p_reason: null })
			);
		});

		it('reports activation without dates as a 409 conflict', async () => {
			const { supabase } = mockSupabase({
				rpc: {
					data: null,
					error: {
						code: '23514',
						message: 'campaign cannot be activated without starts_at and ends_at'
					}
				}
			});
			const result = (await runAction('transition', makeLocals({ supabase }), {
				toStatus: 'active',
				reason: ''
			})) as ActionFailure;
			expect(result.status).toBe(409);
			expect(result.data.message).toBe(
				'Set both the start and end dates before activating the campaign.'
			);
		});

		it('reports an invalid transition (stale page) as a 409 conflict', async () => {
			const { supabase } = mockSupabase({
				rpc: {
					data: null,
					error: { code: '23514', message: 'invalid campaign status transition: closed -> closing' }
				}
			});
			const result = (await runAction('transition', makeLocals({ supabase }), {
				toStatus: 'closing',
				reason: ''
			})) as ActionFailure;
			expect(result.status).toBe(409);
		});
	});
});

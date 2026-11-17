import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';
import {
	ADMIN_PERMISSIONS,
	CAMPAIGN_ID,
	campaignRow,
	makeLocals,
	mockSupabase,
	postRequest,
	type ActionFailure
} from '../../../test-helpers';

const PAGE_URL = `http://localhost:5173/campaigns/${CAMPAIGN_ID}/bonds/new`;
const BOND_ID = 'b0000000-0000-0000-0000-000000000001';
const OTHER_BOND_ID = 'b0000000-0000-0000-0000-000000000002';
const LOADER = [...ADMIN_PERMISSIONS, 'bond.view', 'bond.create'];
const OPERATOR = ['campaign.view', 'bond.view', 'bond.create'];

type QueryResult = { data: unknown; error: unknown };

function setup(
	options: { campaign?: QueryResult; rpc?: QueryResult; permissions?: string[] } = {}
) {
	const mock = mockSupabase({
		tables: { campaigns: options.campaign ?? { data: campaignRow(), error: null } },
		rpc: options.rpc ?? { data: BOND_ID, error: null }
	});
	const locals = makeLocals({
		supabase: mock.supabase,
		permissions: options.permissions ?? LOADER
	});
	return { ...mock, locals };
}

function loadEvent(locals: App.Locals, id = CAMPAIGN_ID) {
	return {
		locals,
		params: { id },
		url: new URL(`http://localhost:5173/campaigns/${id}/bonds/new`)
	} as unknown as Parameters<typeof load>[0];
}

function runAction(locals: App.Locals, fields: Record<string, string>, id = CAMPAIGN_ID) {
	const event = {
		locals,
		params: { id },
		url: new URL(`http://localhost:5173/campaigns/${id}/bonds/new?/default`),
		request: postRequest(PAGE_URL, fields)
	} as unknown as Parameters<typeof actions.default>[0];
	return actions.default(event) as Promise<unknown>;
}

const entry = (fields: Record<string, string> = {}) => ({
	baseNumber: '0068',
	internalCode: '',
	barcode: '',
	...fields
});

const duplicateError = (conflicts: Array<[number, string, string, string]>) => ({
	code: '23505',
	message: `number ${conflicts[0][1]} is already used by bond ${conflicts[0][2]}`,
	details: JSON.stringify({
		conflicts: conflicts.map(([number, formatted, bond_id, number_kind]) => ({
			number,
			formatted,
			bond_id,
			number_kind
		}))
	})
});

describe('/campaigns/[id]/bonds/new', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	describe('load', () => {
		it('redirects anonymous users to login', async () => {
			await expect(load(loadEvent(makeLocals({ signedIn: false })))).rejects.toMatchObject({
				status: 303,
				location: `/login?redirectTo=${encodeURIComponent(`/campaigns/${CAMPAIGN_ID}/bonds/new`)}`
			});
		});

		it('requires bond.create (403), even for a campaign admin', async () => {
			await expect(load(loadEvent(makeLocals({})))).rejects.toMatchObject({
				status: 403,
				body: { permission: 'bond.create' }
			});
			await expect(
				load(loadEvent(makeLocals({ permissions: ['bond.create'] })))
			).rejects.toMatchObject({ status: 403, body: { permission: 'campaign.view' } });
		});

		it('returns 404 for a malformed id without querying, or a missing campaign', async () => {
			const { locals, from } = setup();
			await expect(load(loadEvent(locals, 'nope'))).rejects.toMatchObject({ status: 404 });
			expect(from).not.toHaveBeenCalled();

			const missing = setup({ campaign: { data: null, error: null } });
			await expect(load(loadEvent(missing.locals))).rejects.toMatchObject({
				status: 404,
				body: { message: 'Campaign not found.' }
			});
		});

		it('returns 500 when the campaign cannot be loaded', async () => {
			const { locals } = setup({ campaign: { data: null, error: { message: 'boom' } } });
			await expect(load(loadEvent(locals))).rejects.toMatchObject({ status: 500 });
		});

		it('offers the form for a draft or active campaign (operator)', async () => {
			for (const status of ['draft', 'active']) {
				const { locals } = setup({
					campaign: { data: campaignRow({ status }), error: null },
					permissions: OPERATOR
				});
				const data = (await load(loadEvent(locals)))!;
				expect(data).toMatchObject({ canLoad: true, lockedMessage: null });
				expect(data.campaign).toMatchObject({ id: CAMPAIGN_ID, numberDigits: 4 });
			}
		});

		it('explains why bonds cannot be loaded in a closing, closed or annulled campaign', async () => {
			const { locals } = setup({
				campaign: { data: campaignRow({ status: 'closed' }), error: null }
			});
			const data = (await load(loadEvent(locals)))!;
			expect(data.canLoad).toBe(false);
			expect(data.lockedMessage).toBe(
				'Bonds can only be loaded or changed while the campaign is a draft or active. This campaign is closed.'
			);
		});
	});

	describe('default action', () => {
		it('redirects anonymous users to login', async () => {
			const { rpc } = setup();
			await expect(runAction(makeLocals({ signedIn: false }), entry())).rejects.toMatchObject({
				status: 303
			});
			expect(rpc).not.toHaveBeenCalled();
		});

		it('returns 403 without bond.create and does not touch the database', async () => {
			const { supabase, rpc, from } = setup();
			const result = (await runAction(
				makeLocals({ supabase, permissions: [...ADMIN_PERMISSIONS, 'bond.view'] }),
				entry()
			)) as ActionFailure;
			expect(result.status).toBe(403);
			expect(result.data).toMatchObject({
				form: 'create',
				success: false,
				message: 'You do not have permission to perform this action.'
			});
			expect(rpc).not.toHaveBeenCalled();
			expect(from).not.toHaveBeenCalled();
		});

		it('returns 404 for a malformed or unknown campaign', async () => {
			const { locals, from } = setup();
			expect(((await runAction(locals, entry(), 'nope')) as ActionFailure).status).toBe(404);
			expect(from).not.toHaveBeenCalled();

			const missing = setup({ campaign: { data: null, error: null } });
			const result = (await runAction(missing.locals, entry())) as ActionFailure;
			expect(result.status).toBe(404);
			expect(missing.rpc).not.toHaveBeenCalled();
		});

		it('returns 500 when the campaign lookup fails', async () => {
			const { locals, rpc } = setup({ campaign: { data: null, error: { message: 'boom' } } });
			const result = (await runAction(locals, entry())) as ActionFailure;
			expect(result.status).toBe(500);
			expect(result.data.message).toBe('Something went wrong. Please try again.');
			expect(rpc).not.toHaveBeenCalled();
		});

		it('saves and opens the new bond (Save)', async () => {
			const { locals, rpc } = setup({ permissions: OPERATOR });
			await expect(
				runAction(locals, {
					...entry({ internalCode: ' INT-1 ', barcode: '' }),
					intent: 'save'
				})
			).rejects.toMatchObject({
				status: 303,
				location: `/campaigns/${CAMPAIGN_ID}/bonds/${BOND_ID}`
			});
			expect(rpc).toHaveBeenCalledWith('bond_create', {
				p_campaign_id: CAMPAIGN_ID,
				p_base_numbers: [68],
				p_internal_code: 'INT-1',
				p_barcode: null,
				p_request_id: 'req-test',
				p_reason: null
			});
		});

		it('treats a submit without intent (Enter without JavaScript) like Save', async () => {
			const { locals } = setup();
			await expect(runAction(locals, entry())).rejects.toMatchObject({ status: 303 });
		});

		it('saves and stays on the form with a confirmation (Save & add another)', async () => {
			const { locals, rpc } = setup();
			const result = await runAction(locals, { ...entry({ baseNumber: '68' }), intent: 'another' });
			expect(result).toEqual({
				form: 'create',
				success: true,
				message: 'Bond 0068 / 4939 saved.',
				errors: {},
				created: { id: BOND_ID, baseFormatted: '0068', associatedFormatted: '4939' }
			});
			// Nothing to refill: the form starts empty for the next bond.
			expect(result).not.toHaveProperty('values');
			expect(rpc).toHaveBeenCalledTimes(1);
		});

		it('works with a 5-digit campaign', async () => {
			const { locals, rpc } = setup({
				campaign: {
					data: campaignRow({
						number_digits: 5,
						max_number: 99999,
						associated_number_offset: 48710
					}),
					error: null
				}
			});
			const result = await runAction(locals, { ...entry({ baseNumber: '68' }), intent: 'another' });
			expect(result).toMatchObject({
				message: 'Bond 00068 / 48778 saved.',
				created: { baseFormatted: '00068', associatedFormatted: '48778' }
			});
			expect(rpc).toHaveBeenCalledWith(
				'bond_create',
				expect.objectContaining({ p_base_numbers: [68] })
			);
		});

		it('rejects a missing number, an overflow or too many digits before calling the database', async () => {
			const cases: Array<[string, string]> = [
				['', 'Base number is required'],
				[
					'5129',
					'Base number 5129 overflows: its associated number 10000 exceeds the campaign maximum ' +
						'number 9999 (the highest allowed base number is 5128)'
				],
				['12345', '"12345" is not a valid number (use up to 4 digits)']
			];
			for (const [baseNumber, message] of cases) {
				const { locals, rpc } = setup();
				const form = { ...entry({ baseNumber }), intent: 'another' };
				const result = (await runAction(locals, form)) as ActionFailure;
				expect(result.status).toBe(400);
				expect(result.data).toMatchObject({
					message: 'Please correct the highlighted fields.',
					errors: { baseNumber: [message] },
					values: entry({ baseNumber })
				});
				expect(rpc).not.toHaveBeenCalled();
			}
		});

		it('refuses a campaign that is not draft or active (409) without calling the database', async () => {
			const { locals, rpc } = setup({
				campaign: { data: campaignRow({ status: 'closing' }), error: null }
			});
			const result = (await runAction(locals, entry())) as ActionFailure;
			expect(result.status).toBe(409);
			expect(result.data.message).toBe(
				'Bonds can only be loaded or changed while the campaign is a draft or active. This campaign is closing.'
			);
			expect(rpc).not.toHaveBeenCalled();
		});

		it('reports a duplicate number with the formatted number and a link to the bond using it', async () => {
			const { locals } = setup({
				rpc: {
					data: null,
					error: duplicateError([
						[68, '0068', OTHER_BOND_ID, 'base'],
						[4939, '4939', OTHER_BOND_ID, 'associated']
					])
				}
			});
			const result = (await runAction(locals, { ...entry(), intent: 'another' })) as ActionFailure;
			expect(result.status).toBe(409);
			expect(result.data).toMatchObject({
				success: false,
				message: 'Please correct the highlighted fields.',
				errors: {
					baseNumber: ['Numbers 0068, 4939 are already used by another bond in this campaign.']
				},
				conflicts: [{ field: 'baseNumber', bondId: OTHER_BOND_ID, numbers: ['0068', '4939'] }],
				values: entry()
			});
		});

		it('links every bond when the numbers are used by different bonds', async () => {
			const { locals } = setup({
				rpc: {
					data: null,
					error: duplicateError([
						[129, '0129', BOND_ID, 'associated'],
						[5000, '5000', OTHER_BOND_ID, 'base']
					])
				}
			});
			const result = (await runAction(locals, entry({ baseNumber: '0129' }))) as ActionFailure;
			expect(result.data.errors).toEqual({
				baseNumber: ['Numbers 0129, 5000 are already used by other bonds in this campaign.']
			});
			expect(result.data.conflicts).toEqual([
				{ field: 'baseNumber', bondId: BOND_ID, numbers: ['0129'] },
				{ field: 'baseNumber', bondId: OTHER_BOND_ID, numbers: ['5000'] }
			]);
		});

		it('reports a duplicate internal code on its field, linking the bond instead of naming its id', async () => {
			const { locals } = setup({
				rpc: {
					data: null,
					error: {
						code: '23505',
						message: `internal code INT-1 is already used by bond ${OTHER_BOND_ID}`,
						details: JSON.stringify({ internal_code: 'INT-1', bond_id: OTHER_BOND_ID })
					}
				}
			});
			const result = (await runAction(locals, entry({ internalCode: 'INT-1' }))) as ActionFailure;
			expect(result.status).toBe(409);
			expect(result.data.errors).toEqual({
				internalCode: ['Internal code INT-1 is already used by another bond in this campaign.']
			});
			expect(result.data.conflicts).toEqual([
				{ field: 'internalCode', bondId: OTHER_BOND_ID, numbers: [] }
			]);
		});

		it('maps database rule errors (overflow, campaign status, permission)', async () => {
			const overflow = setup({
				rpc: {
					data: null,
					error: {
						code: '22023',
						message:
							'base number 5129 overflows: its associated number 10000 exceeds the campaign maximum number 9999'
					}
				}
			});
			const overflowResult = (await runAction(overflow.locals, entry())) as ActionFailure;
			expect(overflowResult.status).toBe(400);
			expect((overflowResult.data.errors as Record<string, string[]>).baseNumber[0]).toMatch(
				/^Base number 5129 overflows/
			);

			// The campaign was closed between the lookup and the insert.
			const closed = setup({
				rpc: {
					data: null,
					error: {
						code: '55000',
						message:
							'bonds can only be changed while the campaign is draft or active (status: closing)'
					}
				}
			});
			const closedResult = (await runAction(closed.locals, entry())) as ActionFailure;
			expect(closedResult.status).toBe(409);
			expect(closedResult.data.message).toBe(
				'Bonds can only be loaded or changed while the campaign is a draft or active. This campaign is closing.'
			);

			const denied = setup({
				rpc: { data: null, error: { code: '42501', message: 'permission denied: bond.create' } }
			});
			const deniedResult = (await runAction(denied.locals, entry())) as ActionFailure;
			expect(deniedResult.status).toBe(403);
		});
	});
});

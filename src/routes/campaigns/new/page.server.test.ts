import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';
import {
	CAMPAIGN_ID,
	makeLocals,
	mockSupabase,
	postRequest,
	type ActionFailure
} from '../test-helpers';

const URL_NEW = 'http://localhost:5173/campaigns/new';

const validForm = {
	name: 'Campaign 2027',
	startsOn: '2027-03-01',
	endsOn: '2027-12-31',
	simpleBondValue: '60000',
	installmentCount: '10',
	numberDigits: '4',
	maxNumber: '9999',
	associatedNumberOffset: '4871',
	overflowPolicy: 'reject',
	barcodeMode: 'base_number'
};

function loadEvent(locals: App.Locals) {
	return { locals, url: new URL(URL_NEW) } as unknown as Parameters<typeof load>[0];
}

function actionEvent(locals: App.Locals, fields: Record<string, string>) {
	return {
		locals,
		url: new URL(`${URL_NEW}?/default`),
		request: postRequest(URL_NEW, fields)
	} as unknown as Parameters<typeof actions.default>[0];
}

describe('/campaigns/new', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	describe('load', () => {
		it('requires campaign.create (403)', async () => {
			await expect(
				load(loadEvent(makeLocals({ permissions: ['campaign.view'] })))
			).rejects.toMatchObject({ status: 403, body: { permission: 'campaign.create' } });
		});

		it('answers 500 (not 403) when the permissions failed to load', async () => {
			await expect(load(loadEvent(makeLocals({ permissions: null })))).rejects.toMatchObject({
				status: 500,
				// The first check of the load (requireCampaignViewer) is the one that fails.
				body: { code: 'permission_check_failed', permission: 'campaign.view' }
			});
		});

		it('redirects anonymous users to login', async () => {
			await expect(load(loadEvent(makeLocals({ signedIn: false })))).rejects.toMatchObject({
				status: 303,
				location: '/login?redirectTo=%2Fcampaigns%2Fnew'
			});
		});

		it('renders for a campaign creator', async () => {
			await expect(load(loadEvent(makeLocals({})))).resolves.toEqual({});
		});
	});

	describe('default action', () => {
		it('redirects anonymous users to login (actions do not run layout guards)', async () => {
			const { supabase, rpc } = mockSupabase();
			await expect(
				actions.default(actionEvent(makeLocals({ signedIn: false, supabase }), validForm))
			).rejects.toMatchObject({ status: 303, location: '/login?redirectTo=%2Fcampaigns%2Fnew' });
			expect(rpc).not.toHaveBeenCalled();
		});

		it('returns 403 without campaign.create and does not call the database', async () => {
			const { supabase, rpc } = mockSupabase();
			const result = (await actions.default(
				actionEvent(makeLocals({ permissions: ['campaign.view'], supabase }), validForm)
			)) as ActionFailure;
			expect(result.status).toBe(403);
			expect(result.data).toMatchObject({
				form: 'create',
				success: false,
				message: 'You do not have permission to perform this action.'
			});
			expect(rpc).not.toHaveBeenCalled();
		});

		it('returns 500 (not 403) when the permissions failed to load, without calling the database', async () => {
			const { supabase, rpc } = mockSupabase();
			const result = (await actions.default(
				actionEvent(makeLocals({ permissions: null, supabase }), validForm)
			)) as ActionFailure;
			expect(result.status).toBe(500);
			expect(result.data).toMatchObject({
				form: 'create',
				success: false,
				message: 'Something went wrong. Please try again.'
			});
			expect(rpc).not.toHaveBeenCalled();
		});

		it('returns 400 with field errors and the submitted values', async () => {
			const { supabase, rpc } = mockSupabase();
			const form = { ...validForm, name: '', barcodeMode: '' };
			const result = (await actions.default(
				actionEvent(makeLocals({ supabase }), form)
			)) as ActionFailure;
			expect(result.status).toBe(400);
			expect(result.data.errors).toMatchObject({
				name: ['Name is required'],
				barcodeMode: ['Choose how barcodes are read']
			});
			// The pattern field is only rendered for the internal / external code modes.
			expect(result.data.values).toEqual({ ...form, barcodePattern: '' });
			expect(rpc).not.toHaveBeenCalled();
		});

		it('rejects a value that does not divide exactly before calling the database', async () => {
			const { supabase, rpc } = mockSupabase();
			const result = (await actions.default(
				actionEvent(makeLocals({ supabase }), { ...validForm, installmentCount: '7' })
			)) as ActionFailure;
			expect(result.status).toBe(400);
			expect((result.data.errors as Record<string, string[]>).installmentCount[0]).toMatch(
				/cannot be split into 7 equal installments/
			);
			expect(rpc).not.toHaveBeenCalled();
		});

		it('creates the campaign and redirects to it', async () => {
			const { supabase, rpc } = mockSupabase({ rpc: { data: CAMPAIGN_ID, error: null } });
			await expect(
				actions.default(actionEvent(makeLocals({ supabase }), validForm))
			).rejects.toMatchObject({ status: 303, location: `/campaigns/${CAMPAIGN_ID}` });
			expect(rpc).toHaveBeenCalledWith(
				'campaign_create',
				expect.objectContaining({
					p_name: 'Campaign 2027',
					p_simple_bond_value: '60000.00',
					p_starts_at: '2027-03-01T00:00:00-03:00',
					p_ends_at: '2027-12-31T23:59:59-03:00',
					p_request_id: 'req-test'
				})
			);
		});

		it('accepts Argentine money input (no-JS post) and sends canonical money to SQL', async () => {
			const { supabase, rpc } = mockSupabase({ rpc: { data: CAMPAIGN_ID, error: null } });
			await expect(
				actions.default(
					actionEvent(makeLocals({ supabase }), { ...validForm, simpleBondValue: '60.000,50' })
				)
			).rejects.toMatchObject({ status: 303 });
			expect(rpc).toHaveBeenCalledWith(
				'campaign_create',
				expect.objectContaining({ p_simple_bond_value: '60000.50', p_installment_count: 10 })
			);
		});

		it('rejects 60.000,00 in 7 installments with the es-AR amount in the message', async () => {
			const { supabase, rpc } = mockSupabase();
			const result = (await actions.default(
				actionEvent(makeLocals({ supabase }), {
					...validForm,
					simpleBondValue: '60.000,00',
					installmentCount: '7'
				})
			)) as ActionFailure;
			expect(result.status).toBe(400);
			expect(result.data.errors).toEqual({
				installmentCount: [
					'$ 60.000,00 cannot be split into 7 equal installments. ' +
						'Choose a value and a number of installments that divide exactly (to the cent).'
				]
			});
			expect(rpc).not.toHaveBeenCalled();
		});

		it('maps a database permission denial to 403 (server-side enforcement)', async () => {
			const { supabase } = mockSupabase({
				rpc: {
					data: null,
					error: { code: '42501', message: 'permission denied: campaign.create is required' }
				}
			});
			const result = (await actions.default(
				actionEvent(makeLocals({ supabase }), validForm)
			)) as ActionFailure;
			expect(result.status).toBe(403);
			expect(result.data.message).toBe('You do not have permission to perform this action.');
		});

		it('maps a database rule violation to a field error', async () => {
			const { supabase } = mockSupabase({
				rpc: {
					data: null,
					error: {
						code: '23514',
						message:
							'new row for relation "campaigns" violates check constraint "campaigns_max_number_fits_digits"'
					}
				}
			});
			const result = (await actions.default(
				actionEvent(makeLocals({ supabase }), validForm)
			)) as ActionFailure;
			expect(result.status).toBe(400);
			expect(result.data).toMatchObject({
				message: 'Please correct the highlighted fields.',
				errors: { maxNumber: ['Maximum number must fit in the number of digits.'] },
				values: validForm
			});
		});

		it('maps unexpected database errors to a generic 500', async () => {
			const { supabase } = mockSupabase({
				rpc: { data: null, error: { code: 'XX000', message: 'internal detail' } }
			});
			const result = (await actions.default(
				actionEvent(makeLocals({ supabase }), validForm)
			)) as ActionFailure;
			expect(result.status).toBe(500);
			expect(result.data.message).toBe('Something went wrong. Please try again.');
		});
	});
});

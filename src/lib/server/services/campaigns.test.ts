import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	CAMPAIGN_MESSAGES,
	CampaignServiceError,
	createCampaign,
	mapCampaignRpcError,
	transitionCampaign,
	updateCampaignGeneral,
	updateCampaignRules
} from './campaigns';
import {
	campaignCreateSchema,
	campaignRulesSchema,
	campaignRulesUpdateSchema
} from '$lib/schemas/campaign';

const CAMPAIGN_ID = 'f0000000-0000-0000-0000-000000000001';
/** updated_at as PostgREST returns it; forwarded to the RPC unchanged. */
const VERSION = '2026-11-17T01:02:03.123456+00:00';
const STALE_ERROR = { code: 'PT409', message: 'campaign was modified by someone else' };

function rpcClient(result: { data?: unknown; error?: unknown } | Error) {
	const rpc = vi
		.fn()
		.mockImplementation(() =>
			result instanceof Error
				? Promise.reject(result)
				: Promise.resolve({ data: result.data ?? null, error: result.error ?? null })
		);
	return { supabase: { rpc } as unknown as SupabaseClient, rpc };
}

const createInput = campaignCreateSchema.parse({
	name: 'Campaign 2027',
	startsOn: '2027-03-01',
	endsOn: '',
	simpleBondValue: '60000',
	installmentCount: '10',
	numberDigits: '4',
	maxNumber: '9999',
	associatedNumberOffset: '4871',
	overflowPolicy: 'reject',
	barcodeMode: 'base_number'
});

describe('mapCampaignRpcError', () => {
	it.each([
		[
			{ code: '42501', message: 'permission denied: campaign.create is required' },
			'permission',
			403,
			CAMPAIGN_MESSAGES.permission,
			undefined
		],
		[
			{ code: '42501', message: 'an active profile is required to change campaigns' },
			'permission',
			403,
			CAMPAIGN_MESSAGES.permission,
			undefined
		],
		[
			{ code: '42501', message: 'permission denied for function campaign_create' },
			'permission',
			403,
			CAMPAIGN_MESSAGES.permission,
			undefined
		],
		[
			{ code: 'P0002', message: 'campaign x not found' },
			'not_found',
			404,
			CAMPAIGN_MESSAGES.notFound,
			undefined
		],
		[
			{
				code: '22023',
				message: 'simple bond value 60000.00 cannot be split into 7 equal installments'
			},
			'validation',
			400,
			'The simple bond value cannot be split into 7 equal installments. Choose a value and a number of installments that divide exactly (to the cent).',
			'installmentCount'
		],
		[
			{ code: '22023', message: 'simple bond value must have at most 2 decimal places' },
			'validation',
			400,
			'Simple bond value must have at most 2 decimal places.',
			'simpleBondValue'
		],
		[
			{ code: '22023', message: 'installment count must be greater than 0' },
			'validation',
			400,
			'Installment count must be greater than 0.',
			'installmentCount'
		],
		[
			{ code: '22023', message: 'campaign name is required' },
			'validation',
			400,
			'Name is required.',
			'name'
		],
		[
			{ code: '22023', message: 'a reason is required to annul a campaign' },
			'validation',
			400,
			CAMPAIGN_MESSAGES.reasonRequired,
			'reason'
		],
		[
			{ code: '22023', message: 'invalid target status: draft' },
			'validation',
			400,
			'Unknown status change.',
			'toStatus'
		],
		[
			{ code: '22023', message: 'something new' },
			'validation',
			400,
			CAMPAIGN_MESSAGES.invalid,
			undefined
		],
		[
			{
				code: '23514',
				message:
					'new row for relation "campaigns" violates check constraint "campaigns_max_number_fits_digits"'
			},
			'validation',
			400,
			'Maximum number must fit in the number of digits.',
			'maxNumber'
		],
		[
			{
				code: '23514',
				message:
					'new row for relation "campaigns" violates check constraint "campaigns_dates_order"'
			},
			'validation',
			400,
			'End date must be after the start date.',
			'endsOn'
		],
		[
			{
				code: '23514',
				message: 'new row for relation "campaigns" violates check constraint "unknown_check"'
			},
			'validation',
			400,
			CAMPAIGN_MESSAGES.invalid,
			undefined
		],
		[
			{ code: '23514', message: 'campaign cannot be activated without starts_at and ends_at' },
			'conflict',
			409,
			CAMPAIGN_MESSAGES.activationNeedsDates,
			undefined
		],
		[
			{
				code: '23514',
				message:
					'campaign starts_at and ends_at cannot be cleared once the campaign was activated (status: active)'
			},
			'conflict',
			409,
			CAMPAIGN_MESSAGES.datesCannotBeCleared,
			'startsOn'
		],
		[
			{ code: '23514', message: 'invalid campaign status transition: closed -> active' },
			'conflict',
			409,
			'This campaign is closed and cannot be moved to active. Reload the page to see its current status.',
			undefined
		],
		[
			{ code: '23514', message: 'invalid campaign status transition: active -> active' },
			'conflict',
			409,
			'The campaign is already active.',
			undefined
		],
		[
			{
				code: '55000',
				message: 'campaign rules can only be changed while the campaign is draft (status: active)',
				details: 'changed rule columns: max_number'
			},
			'conflict',
			409,
			CAMPAIGN_MESSAGES.rulesFrozen,
			undefined
		],
		[
			{ code: '55000', message: 'campaign rules cannot be changed once the campaign has bonds' },
			'conflict',
			409,
			CAMPAIGN_MESSAGES.rulesFrozenByBonds,
			undefined
		],
		[
			{
				code: '55000',
				message:
					'campaign dates can only be changed while the campaign is draft or active (status: closing)'
			},
			'conflict',
			409,
			CAMPAIGN_MESSAGES.datesFrozen,
			undefined
		],
		[
			{ code: '55000', message: 'campaign name cannot be changed once the campaign is closed' },
			'conflict',
			409,
			CAMPAIGN_MESSAGES.nameFrozen,
			undefined
		],
		[
			{
				code: '55000',
				message:
					'installment count cannot be lowered below 5 while an active commission rule applies to installment 5'
			},
			'validation',
			400,
			'A commission rule applies to installment 5. Use at least 5 installments, or edit or annul that commission rule first.',
			'installmentCount'
		],
		[
			{
				code: 'PT409',
				message: 'campaign was modified by someone else',
				details: 'campaign f0000000-0000-0000-0000-000000000001: expected updated_at …',
				hint: 'reload the campaign and apply the change again'
			},
			'conflict',
			409,
			CAMPAIGN_MESSAGES.staleVersion,
			undefined
		],
		[
			{
				code: '23514',
				message:
					'new row for relation "campaigns" violates check constraint "campaigns_number_digits_range"'
			},
			'validation',
			400,
			'Number of digits must be between 1 and 10.',
			'numberDigits'
		],
		[
			{
				code: '23502',
				message:
					'null value in column "barcode_mode" of relation "campaigns" violates not-null constraint'
			},
			'validation',
			400,
			'A required value is missing.',
			'barcodeMode'
		],
		[
			{ code: '22003', message: 'numeric field overflow' },
			'validation',
			400,
			'A value is too large.',
			undefined
		],
		[
			{ code: '22P02', message: 'invalid input syntax for type uuid' },
			'validation',
			400,
			CAMPAIGN_MESSAGES.invalid,
			undefined
		],
		[
			{ code: 'PGRST202', message: 'Could not find the function' },
			'internal',
			500,
			CAMPAIGN_MESSAGES.internal,
			undefined
		],
		[
			{ code: '23001', message: 'campaigns.id, created_at and created_by cannot be changed' },
			'internal',
			500,
			CAMPAIGN_MESSAGES.internal,
			undefined
		]
	])('maps %o', (rpcError, kind, status, message, field) => {
		const mapped = mapCampaignRpcError(rpcError);
		expect(mapped).toBeInstanceOf(CampaignServiceError);
		expect(mapped.kind).toBe(kind);
		expect(mapped.status).toBe(status);
		expect(mapped.message).toBe(message);
		expect(mapped.field).toBe(field);
		expect(mapped.cause).toBe(rpcError);
	});
});

describe('campaign service', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	it('createCampaign calls campaign_create with exact money strings and returns the id', async () => {
		const { supabase, rpc } = rpcClient({ data: CAMPAIGN_ID });
		await expect(createCampaign(supabase, createInput, { requestId: 'req-1' })).resolves.toBe(
			CAMPAIGN_ID
		);
		expect(rpc).toHaveBeenCalledWith('campaign_create', {
			p_name: 'Campaign 2027',
			p_simple_bond_value: '60000.00',
			p_installment_count: 10,
			p_number_digits: 4,
			p_max_number: 9999,
			p_associated_number_offset: 4871,
			p_overflow_policy: 'reject',
			p_barcode_mode: 'base_number',
			p_starts_at: '2027-03-01T00:00:00-03:00',
			p_ends_at: null,
			p_request_id: 'req-1'
		});
	});

	it('createCampaign fails as internal when no id comes back', async () => {
		const { supabase } = rpcClient({ data: null });
		await expect(createCampaign(supabase, createInput)).rejects.toMatchObject({ kind: 'internal' });
	});

	it('maps RPC errors to typed errors', async () => {
		const { supabase } = rpcClient({
			error: { code: '42501', message: 'permission denied: campaign.create is required' }
		});
		await expect(createCampaign(supabase, createInput)).rejects.toMatchObject({
			kind: 'permission',
			status: 403
		});
		expect(console.error).not.toHaveBeenCalled();
	});

	it('logs and reports internal errors without leaking details', async () => {
		const { supabase } = rpcClient({ error: { code: 'XX000', message: 'boom' } });
		const err = await createCampaign(supabase, createInput).catch((e) => e);
		expect(err).toMatchObject({ kind: 'internal', message: CAMPAIGN_MESSAGES.internal });
		expect(console.error).toHaveBeenCalled();
	});

	it('turns a thrown RPC (network) into an internal error', async () => {
		const { supabase } = rpcClient(new Error('fetch failed'));
		await expect(createCampaign(supabase, createInput)).rejects.toMatchObject({ kind: 'internal' });
	});

	it('updateCampaignGeneral passes name and timestamps and returns whether anything changed', async () => {
		const { supabase, rpc } = rpcClient({ data: false });
		await expect(
			updateCampaignGeneral(
				supabase,
				CAMPAIGN_ID,
				{
					name: 'Renamed',
					startsAt: null,
					endsAt: '2027-12-31T23:59:59-03:00',
					expectedUpdatedAt: VERSION
				},
				{ requestId: 'req-2' }
			)
		).resolves.toBe(false);
		expect(rpc).toHaveBeenCalledWith('campaign_update', {
			p_id: CAMPAIGN_ID,
			p_name: 'Renamed',
			p_starts_at: null,
			p_ends_at: '2027-12-31T23:59:59-03:00',
			p_expected_updated_at: VERSION,
			p_request_id: 'req-2'
		});
	});

	it('updateCampaignRules passes every rule (installment value is computed by the database)', async () => {
		const { supabase, rpc } = rpcClient({ data: true });
		const input = campaignRulesSchema.parse({
			simpleBondValue: '90000.50',
			installmentCount: '2',
			numberDigits: '5',
			maxNumber: '99999',
			associatedNumberOffset: '4871',
			overflowPolicy: 'reject',
			barcodeMode: 'manual_mapping',
			expectedUpdatedAt: VERSION
		});
		await expect(updateCampaignRules(supabase, CAMPAIGN_ID, input)).resolves.toBe(true);
		expect(rpc).toHaveBeenCalledWith('campaign_update_rules', {
			p_id: CAMPAIGN_ID,
			p_simple_bond_value: '90000.50',
			p_installment_count: 2,
			p_number_digits: 5,
			p_max_number: 99999,
			p_associated_number_offset: 4871,
			p_overflow_policy: 'reject',
			p_barcode_mode: 'manual_mapping',
			p_expected_updated_at: VERSION,
			p_request_id: null,
			p_reason: null
		});
	});

	it('updateCampaignRules passes the audit reason', async () => {
		const { supabase, rpc } = rpcClient({ data: true });
		const input = campaignRulesUpdateSchema.parse({
			simpleBondValue: '60.000',
			installmentCount: '12',
			numberDigits: '4',
			maxNumber: '9999',
			associatedNumberOffset: '4871',
			overflowPolicy: 'reject',
			barcodeMode: 'base_number',
			changeReason: '  Board decision ',
			confirmRulesChange: 'yes',
			expectedUpdatedAt: VERSION
		});
		await updateCampaignRules(supabase, CAMPAIGN_ID, input, { requestId: 'req-r' });
		expect(rpc).toHaveBeenCalledWith(
			'campaign_update_rules',
			expect.objectContaining({
				p_reason: 'Board decision',
				p_expected_updated_at: VERSION,
				p_request_id: 'req-r'
			})
		);
	});

	it.each([
		[
			'updateCampaignGeneral',
			() =>
				updateCampaignGeneral(rpcClient({ error: STALE_ERROR }).supabase, CAMPAIGN_ID, {
					name: 'Renamed',
					startsAt: null,
					endsAt: null,
					expectedUpdatedAt: VERSION
				})
		],
		[
			'updateCampaignRules',
			() =>
				updateCampaignRules(
					rpcClient({ error: STALE_ERROR }).supabase,
					CAMPAIGN_ID,
					campaignRulesSchema.parse({
						simpleBondValue: '60000',
						installmentCount: '10',
						numberDigits: '4',
						maxNumber: '9999',
						associatedNumberOffset: '4871',
						overflowPolicy: 'reject',
						barcodeMode: 'base_number',
						expectedUpdatedAt: VERSION
					})
				)
		]
	])('%s maps a stale version (PT409) to a 409 conflict asking to reload', async (_name, call) => {
		const err = await call().catch((e) => e);
		expect(err).toBeInstanceOf(CampaignServiceError);
		expect(err).toMatchObject({
			kind: 'conflict',
			status: 409,
			message: CAMPAIGN_MESSAGES.staleVersion
		});
		expect(err.message).toMatch(/changed by someone else.*Reload the page/);
		expect(console.error).not.toHaveBeenCalled();
	});

	it('transitionCampaign passes the target status and reason', async () => {
		const { supabase, rpc } = rpcClient({ data: null });
		await transitionCampaign(
			supabase,
			CAMPAIGN_ID,
			{ toStatus: 'annulled', reason: 'Mistake' },
			{ requestId: 'req-3' }
		);
		expect(rpc).toHaveBeenCalledWith('campaign_transition', {
			p_id: CAMPAIGN_ID,
			p_to_status: 'annulled',
			p_reason: 'Mistake',
			p_request_id: 'req-3'
		});
	});

	it('transitionCampaign surfaces state conflicts from the write guard', async () => {
		const { supabase } = rpcClient({
			error: {
				code: '23514',
				message: 'campaign cannot be activated without starts_at and ends_at'
			}
		});
		await expect(
			transitionCampaign(supabase, CAMPAIGN_ID, { toStatus: 'active', reason: null })
		).rejects.toMatchObject({ kind: 'conflict', message: CAMPAIGN_MESSAGES.activationNeedsDates });
	});
});

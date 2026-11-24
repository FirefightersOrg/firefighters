import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	annulCommissionRule,
	COMMISSION_RULE_MESSAGES,
	CommissionRuleServiceError,
	createCommissionRule,
	mapCommissionRuleRpcError,
	updateCommissionRule
} from './commission-rules';
import { commissionRuleSchema } from '$lib/schemas/commission-rule';

const CAMPAIGN_ID = 'f0000000-0000-0000-0000-000000000001';
const RULE_ID = 'a0000000-0000-0000-0000-000000000001';
/** updated_at as PostgREST returns it; forwarded to the RPC unchanged. */
const VERSION = '2026-11-17T01:02:03.123456+00:00';

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

const input = commissionRuleSchema(10).parse({
	ruleType: 'custom',
	installmentNumber: '4',
	valueKind: 'percentage',
	percentage: '12,5',
	fixedAmount: '',
	validFrom: '2026-01-01',
	validTo: '2026-06-30',
	reason: 'Agreement'
});

describe('mapCommissionRuleRpcError', () => {
	it.each([
		[
			{ code: '42501', message: 'permission denied: commission.rule_manage is required' },
			'permission',
			403,
			COMMISSION_RULE_MESSAGES.permission,
			undefined
		],
		[
			{
				code: '23P01',
				message: 'conflicting key value violates exclusion constraint "commission_rules_no_overlap"'
			},
			'conflict',
			409,
			COMMISSION_RULE_MESSAGES.overlap,
			undefined
		],
		[
			{ code: 'P0002', message: `campaign ${CAMPAIGN_ID} not found` },
			'not_found',
			404,
			COMMISSION_RULE_MESSAGES.campaignNotFound,
			undefined
		],
		[
			{ code: 'P0002', message: `commission rule ${RULE_ID} not found` },
			'not_found',
			404,
			COMMISSION_RULE_MESSAGES.ruleNotFound,
			undefined
		],
		[
			{ code: '22023', message: 'installment number must be between 1 and 10' },
			'validation',
			400,
			'El número de cuota debe estar entre 1 y 10.',
			'installmentNumber'
		],
		[
			{ code: '22023', message: 'installment number is required for custom rules' },
			'validation',
			400,
			'El número de cuota no es válido.',
			'installmentNumber'
		],
		[
			{ code: '22023', message: 'percentage must have at most 2 decimal places' },
			'validation',
			400,
			'El porcentaje no es válido.',
			'percentage'
		],
		[
			{ code: '22023', message: 'fixed amount must be greater than 0' },
			'validation',
			400,
			'El monto fijo no es válido.',
			'fixedAmount'
		],
		[
			{ code: '22023', message: 'exactly one of percentage or fixed amount is required' },
			'validation',
			400,
			'Ingresar un porcentaje o un monto fijo, no ambos.',
			'valueKind'
		],
		[
			{ code: '22023', message: 'invalid commission rule type: bonus' },
			'validation',
			400,
			'Tipo de regla desconocido.',
			'ruleType'
		],
		[
			{ code: '22023', message: 'valid to date must be on or after the valid from date' },
			'validation',
			400,
			'La fecha de fin de vigencia debe ser igual o posterior a la de inicio.',
			'validTo'
		],
		[
			{ code: '22023', message: 'a reason is required to annul a commission rule' },
			'validation',
			400,
			COMMISSION_RULE_MESSAGES.reasonRequired,
			'reason'
		],
		[
			{
				code: '23514',
				message:
					'new row for relation "commission_rules" violates check constraint "commission_rules_percentage_range"'
			},
			'validation',
			400,
			'El porcentaje debe ser mayor que 0 y hasta 100.',
			'percentage'
		],
		[
			{
				code: '23514',
				message: 'installment number 11 exceeds the campaign installment count (10)'
			},
			'validation',
			400,
			'El número de cuota debe estar entre 1 y 10.',
			'installmentNumber'
		],
		[
			{
				code: '55000',
				message:
					'commission rules can only be changed while the campaign is draft or active (status: closed)'
			},
			'conflict',
			409,
			COMMISSION_RULE_MESSAGES.campaignLocked,
			undefined
		],
		[
			{ code: '55000', message: `commission rule ${RULE_ID} is already annulled` },
			'conflict',
			409,
			COMMISSION_RULE_MESSAGES.alreadyAnnulled,
			undefined
		],
		[
			{ code: '55000', message: `commission rule ${RULE_ID} is annulled and cannot be changed` },
			'conflict',
			409,
			COMMISSION_RULE_MESSAGES.annulled,
			undefined
		],
		[
			{
				code: 'PT409',
				message: 'commission rule was modified by someone else',
				details: `commission rule ${RULE_ID}: expected updated_at …`
			},
			'conflict',
			409,
			COMMISSION_RULE_MESSAGES.staleVersion,
			undefined
		],
		[
			{ code: '22023', message: 'fixed amount must be a finite number' },
			'validation',
			400,
			'El monto fijo no es válido.',
			'fixedAmount'
		],
		[
			{ code: '22023', message: 'percentage must be a finite number' },
			'validation',
			400,
			'El porcentaje no es válido.',
			'percentage'
		],
		[
			{ code: 'XX000', message: 'boom' },
			'internal',
			500,
			COMMISSION_RULE_MESSAGES.internal,
			undefined
		]
	])('%o → %s', (error, kind, status, message, field) => {
		const mapped = mapCommissionRuleRpcError(error);
		expect(mapped).toBeInstanceOf(CommissionRuleServiceError);
		expect(mapped.kind).toBe(kind);
		expect(mapped.status).toBe(status);
		expect(mapped.message).toBe(message);
		expect(mapped.field).toBe(field);
	});
});

describe('commission rule service', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	it('creates a rule with exact decimal strings and the request id', async () => {
		const { supabase, rpc } = rpcClient({ data: RULE_ID });
		await expect(
			createCommissionRule(supabase, CAMPAIGN_ID, input, { requestId: 'req-1' })
		).resolves.toBe(RULE_ID);
		expect(rpc).toHaveBeenCalledWith('commission_rule_create', {
			p_campaign_id: CAMPAIGN_ID,
			p_rule_type: 'custom',
			p_installment_number: 4,
			p_percentage: '12.50',
			p_fixed_amount: null,
			p_valid_from: '2026-01-01',
			p_valid_to: '2026-06-30',
			p_reason: 'Agreement',
			p_request_id: 'req-1'
		});
	});

	it('treats a missing id as an internal error', async () => {
		const { supabase } = rpcClient({ data: null });
		await expect(createCommissionRule(supabase, CAMPAIGN_ID, input)).rejects.toMatchObject({
			kind: 'internal'
		});
	});

	it('updates a rule and reports whether something changed', async () => {
		const { supabase, rpc } = rpcClient({ data: false });
		await expect(
			updateCommissionRule(supabase, { ...input, ruleId: RULE_ID, expectedUpdatedAt: VERSION })
		).resolves.toBe(false);
		expect(rpc).toHaveBeenCalledWith(
			'commission_rule_update',
			expect.objectContaining({
				p_id: RULE_ID,
				p_percentage: '12.50',
				p_expected_updated_at: VERSION,
				p_request_id: null
			})
		);
	});

	it('maps a stale version (PT409) to a 409 conflict asking to reload', async () => {
		const { supabase } = rpcClient({
			error: { code: 'PT409', message: 'commission rule was modified by someone else' }
		});
		const err = await updateCommissionRule(supabase, {
			...input,
			ruleId: RULE_ID,
			expectedUpdatedAt: VERSION
		}).catch((e) => e);
		expect(err).toBeInstanceOf(CommissionRuleServiceError);
		expect(err).toMatchObject({
			kind: 'conflict',
			status: 409,
			message: COMMISSION_RULE_MESSAGES.staleVersion
		});
		expect(err.message).toMatch(/Otra persona modificó.*Recargar la página/);
		expect(console.error).not.toHaveBeenCalled();
	});

	it('annuls a rule with its reason', async () => {
		const { supabase, rpc } = rpcClient({ data: null });
		await annulCommissionRule(supabase, { ruleId: RULE_ID, reason: 'Mistake' }, { requestId: 'r' });
		expect(rpc).toHaveBeenCalledWith('commission_rule_annul', {
			p_id: RULE_ID,
			p_reason: 'Mistake',
			p_request_id: 'r'
		});
	});

	it('maps RPC errors and network failures', async () => {
		const overlap = rpcClient({
			error: { code: '23P01', message: 'conflicting key value violates exclusion constraint' }
		});
		await expect(createCommissionRule(overlap.supabase, CAMPAIGN_ID, input)).rejects.toMatchObject({
			kind: 'conflict',
			message: COMMISSION_RULE_MESSAGES.overlap
		});
		const network = rpcClient(new Error('fetch failed'));
		await expect(
			annulCommissionRule(network.supabase, { ruleId: RULE_ID, reason: 'x' })
		).rejects.toMatchObject({ kind: 'internal' });
	});
});

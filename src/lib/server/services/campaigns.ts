import type { SupabaseClient } from '@supabase/supabase-js';
import { CAMPAIGN_STATUS_LABELS, type CampaignStatus } from '$lib/domain/campaigns';
import type {
	CampaignCreateInput,
	CampaignFormField,
	CampaignGeneralInput,
	CampaignRulesInput,
	CampaignRulesUpdateInput,
	CampaignTransitionInput
} from '$lib/schemas/campaign';
import { CAMPAIGN_NAME_MAX_LENGTH } from '$lib/schemas/campaign';

/**
 * Campaign use cases. Every write calls one audited SQL function with the USER-SCOPED client
 * (`locals.supabase`), so the database checks the caller's active profile and permission and
 * writes the change plus its `audit_log` row in one transaction
 * (migration `20261117000000_campaign_rpcs.sql`).
 *
 * Errors are thrown as `CampaignServiceError` with a kind the routes map to HTTP statuses and a
 * message that is safe to show to the user.
 */

export type CampaignErrorKind = 'validation' | 'permission' | 'conflict' | 'not_found' | 'internal';

const STATUS_BY_KIND: Record<CampaignErrorKind, number> = {
	validation: 400,
	permission: 403,
	not_found: 404,
	conflict: 409,
	internal: 500
};

export class CampaignServiceError extends Error {
	readonly kind: CampaignErrorKind;
	/** Form field the error belongs to, when it can be attributed to one. */
	readonly field?: CampaignFormField;

	constructor(
		kind: CampaignErrorKind,
		message: string,
		options?: { field?: CampaignFormField; cause?: unknown }
	) {
		super(message, { cause: options?.cause });
		this.name = 'CampaignServiceError';
		this.kind = kind;
		this.field = options?.field;
	}

	/** HTTP status for this error (400, 403, 404, 409 or 500). */
	get status(): number {
		return STATUS_BY_KIND[this.kind];
	}
}

interface PostgrestLikeError {
	code?: string;
	message: string;
	details?: string | null;
	hint?: string | null;
}

export const CAMPAIGN_MESSAGES = {
	permission: 'You do not have permission to perform this action.',
	notFound: 'Campaign not found.',
	internal: 'Something went wrong. Please try again.',
	invalid: 'Some values are invalid. Please review the form.',
	activationNeedsDates: 'Set both the start and end dates before activating the campaign.',
	datesCannotBeCleared:
		'Start and end dates cannot be removed once the campaign has been activated.',
	rulesFrozen:
		'Rules can only be changed while the campaign is a draft. They were frozen when the campaign was activated.',
	rulesFrozenByBonds:
		'Rules can no longer be changed: this campaign already has bonds, and their numbers and values depend on the rules.',
	staleVersion:
		'This campaign was changed by someone else while you were editing it. Reload the page to see the latest changes, then make your edit again.',
	datesFrozen: 'Dates can only be changed while the campaign is a draft or active.',
	nameFrozen: 'The name of a closed or annulled campaign cannot be changed.',
	reasonRequired: 'A reason is required to annul a campaign.'
} as const;

/** Friendly messages for the table CHECK constraints (SAN-16), by constraint name. */
const CONSTRAINT_MESSAGES: Record<string, { field: CampaignFormField; message: string }> = {
	campaigns_name_not_blank: { field: 'name', message: 'Name is required.' },
	campaigns_name_max_length: {
		field: 'name',
		message: `Name must be at most ${CAMPAIGN_NAME_MAX_LENGTH} characters.`
	},
	campaigns_dates_order: { field: 'endsOn', message: 'End date must be after the start date.' },
	campaigns_simple_bond_value_positive: {
		field: 'simpleBondValue',
		message: 'Simple bond value must be greater than 0.'
	},
	campaigns_installment_count_positive: {
		field: 'installmentCount',
		message: 'Number of installments must be greater than 0.'
	},
	campaigns_installment_value_positive: {
		field: 'installmentCount',
		message: 'Each installment must be greater than 0.'
	},
	campaigns_installment_value_exact: {
		field: 'installmentCount',
		message: 'The simple bond value must divide exactly into the installments.'
	},
	campaigns_number_digits_range: {
		field: 'numberDigits',
		message: 'Number of digits must be between 1 and 10.'
	},
	campaigns_max_number_positive: {
		field: 'maxNumber',
		message: 'Maximum number must be greater than 0.'
	},
	campaigns_max_number_fits_digits: {
		field: 'maxNumber',
		message: 'Maximum number must fit in the number of digits.'
	},
	campaigns_associated_number_offset_nonnegative: {
		field: 'associatedNumberOffset',
		message: 'Associated number offset cannot be negative.'
	},
	campaigns_associated_number_offset_within_max: {
		field: 'associatedNumberOffset',
		message: 'Associated number offset must not exceed the maximum number.'
	},
	campaigns_overflow_policy_check: { field: 'overflowPolicy', message: 'Unknown overflow policy.' },
	campaigns_barcode_mode_check: { field: 'barcodeMode', message: 'Unknown barcode mode.' },
	campaigns_barcode_pattern_format: {
		field: 'barcodePattern',
		message: 'Barcode pattern must be at most 200 characters, without surrounding spaces.'
	},
	campaigns_barcode_pattern_mode: {
		field: 'barcodePattern',
		message: 'A barcode pattern is only used with the internal or external/legacy code modes.'
	},
	campaigns_barcode_pattern_valid: {
		field: 'barcodePattern',
		message: 'Barcode pattern must be a valid regular expression with a capture group.'
	}
};

const COLUMN_FIELDS: Record<string, CampaignFormField> = {
	name: 'name',
	simple_bond_value: 'simpleBondValue',
	installment_count: 'installmentCount',
	number_digits: 'numberDigits',
	max_number: 'maxNumber',
	associated_number_offset: 'associatedNumberOffset',
	overflow_policy: 'overflowPolicy',
	barcode_mode: 'barcodeMode',
	barcode_pattern: 'barcodePattern'
};

function statusLabel(status: string): string {
	return CAMPAIGN_STATUS_LABELS[status as CampaignStatus]?.toLowerCase() ?? status;
}

/** Maps a PostgREST/Postgres error from a `campaign_*` function to a `CampaignServiceError`. */
export function mapCampaignRpcError(rpcError: PostgrestLikeError): CampaignServiceError {
	const message = rpcError.message ?? '';
	const err = (kind: CampaignErrorKind, text: string, field?: CampaignFormField) =>
		new CampaignServiceError(kind, text, { field, cause: rpcError });

	switch (rpcError.code) {
		case '42501':
			return err('permission', CAMPAIGN_MESSAGES.permission);

		case 'P0002':
			return err('not_found', CAMPAIGN_MESSAGES.notFound);

		// Optimistic concurrency: the campaign changed after the form was loaded (nothing written).
		// PT409 (not 40001, which PostgREST would retry forever); PostgREST answers HTTP 409.
		case 'PT409':
			return err('conflict', CAMPAIGN_MESSAGES.staleVersion);

		case '22023': {
			const split = /cannot be split into (\d+) equal installments/.exec(message);
			if (split) {
				return err(
					'validation',
					`The simple bond value cannot be split into ${split[1]} equal installments. ` +
						'Choose a value and a number of installments that divide exactly (to the cent).',
					'installmentCount'
				);
			}
			if (message.startsWith('simple bond value')) {
				return err('validation', `${capitalize(message)}.`, 'simpleBondValue');
			}
			if (message.startsWith('barcode pattern')) {
				return err('validation', `${capitalize(message)}.`, 'barcodePattern');
			}
			if (message.startsWith('installment count')) {
				return err('validation', `${capitalize(message)}.`, 'installmentCount');
			}
			if (message === 'campaign name is required') {
				return err('validation', 'Name is required.', 'name');
			}
			if (message === 'a reason is required to annul a campaign') {
				return err('validation', CAMPAIGN_MESSAGES.reasonRequired, 'reason');
			}
			if (message.startsWith('invalid target status')) {
				return err('validation', 'Unknown status change.', 'toStatus');
			}
			return err('validation', CAMPAIGN_MESSAGES.invalid);
		}

		case '23514': {
			const constraint = /violates check constraint "([^"]+)"/.exec(message)?.[1];
			if (constraint) {
				const known = CONSTRAINT_MESSAGES[constraint];
				return known
					? err('validation', known.message, known.field)
					: err('validation', CAMPAIGN_MESSAGES.invalid);
			}
			// Raised by the campaigns_guard_write trigger: the change is not allowed in this status.
			if (message.includes('cannot be activated without starts_at and ends_at')) {
				return err('conflict', CAMPAIGN_MESSAGES.activationNeedsDates);
			}
			if (message.includes('cannot be cleared once the campaign was activated')) {
				return err('conflict', CAMPAIGN_MESSAGES.datesCannotBeCleared, 'startsOn');
			}
			const transition = /invalid campaign status transition: (\w+) -> (\w+)/.exec(message);
			if (transition) {
				const [, from, to] = transition;
				return err(
					'conflict',
					from === to
						? `The campaign is already ${statusLabel(to)}.`
						: `This campaign is ${statusLabel(from)} and cannot be moved to ${statusLabel(to)}. ` +
								'Reload the page to see its current status.'
				);
			}
			return err('internal', CAMPAIGN_MESSAGES.internal);
		}

		case '55000': {
			// SAN-20: a draft's installment count cannot drop below an active commission rule
			// for a specific installment (campaigns_guard_commission_installments).
			const belowRule = /installment count cannot be lowered below (\d+)/.exec(message);
			if (belowRule) {
				return err(
					'validation',
					`A commission rule applies to installment ${belowRule[1]}. Use at least ${belowRule[1]} ` +
						'installments, or edit or annul that commission rule first.',
					'installmentCount'
				);
			}
			// SAN-22: once a campaign has bonds its rules are frozen, even in draft
			// (campaigns_rules_frozen_with_bonds).
			if (message.includes('cannot be changed once the campaign has bonds')) {
				return err('conflict', CAMPAIGN_MESSAGES.rulesFrozenByBonds);
			}
			if (message.includes('rules can only be changed')) {
				return err('conflict', CAMPAIGN_MESSAGES.rulesFrozen);
			}
			if (message.includes('dates can only be changed')) {
				return err('conflict', CAMPAIGN_MESSAGES.datesFrozen);
			}
			if (message.includes('name cannot be changed')) {
				return err('conflict', CAMPAIGN_MESSAGES.nameFrozen);
			}
			return err('conflict', 'This change is not allowed in the current campaign status.');
		}

		case '23502': {
			const column = /null value in column "([^"]+)"/.exec(message)?.[1];
			const field = column ? COLUMN_FIELDS[column] : undefined;
			return err('validation', 'A required value is missing.', field);
		}

		case '22003':
			return err('validation', 'A value is too large.');

		case '22P02':
		case '22007':
		case '22008':
			return err('validation', CAMPAIGN_MESSAGES.invalid);

		default:
			return err('internal', CAMPAIGN_MESSAGES.internal);
	}
}

function capitalize(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface CampaignRequestContext {
	requestId?: string | null;
}

async function callCampaignRpc(
	supabase: SupabaseClient,
	fn: string,
	args: Record<string, unknown>,
	ctx: CampaignRequestContext
): Promise<unknown> {
	let result: { data: unknown; error: PostgrestLikeError | null };
	try {
		result = await supabase.rpc(fn, args);
	} catch (cause) {
		console.error(`[campaigns] ${fn} RPC threw`, { requestId: ctx.requestId, error: cause });
		throw new CampaignServiceError('internal', CAMPAIGN_MESSAGES.internal, { cause });
	}

	if (result.error) {
		const mapped = mapCampaignRpcError(result.error);
		if (mapped.kind === 'internal') {
			console.error(`[campaigns] ${fn} RPC failed`, {
				requestId: ctx.requestId,
				error: result.error
			});
		}
		throw mapped;
	}
	return result.data;
}

/** Creates a draft campaign (`campaign.create`). Returns the new campaign id. */
export async function createCampaign(
	supabase: SupabaseClient,
	input: CampaignCreateInput,
	ctx: CampaignRequestContext = {}
): Promise<string> {
	const data = await callCampaignRpc(
		supabase,
		'campaign_create',
		{
			p_name: input.name,
			// Exact decimal string; Postgres parses it into numeric without float rounding.
			p_simple_bond_value: input.simpleBondValue,
			p_installment_count: input.installmentCount,
			p_number_digits: input.numberDigits,
			p_max_number: input.maxNumber,
			p_associated_number_offset: input.associatedNumberOffset,
			p_overflow_policy: input.overflowPolicy,
			p_barcode_mode: input.barcodeMode,
			p_barcode_pattern: input.barcodePattern,
			p_starts_at: input.startsAt,
			p_ends_at: input.endsAt,
			p_request_id: ctx.requestId ?? null
		},
		ctx
	);
	if (typeof data !== 'string' || data.length === 0) {
		console.error('[campaigns] campaign_create returned no id', { requestId: ctx.requestId, data });
		throw new CampaignServiceError('internal', CAMPAIGN_MESSAGES.internal);
	}
	return data;
}

/**
 * Updates name and dates (`campaign.update`). Returns false when nothing changed (no audit row).
 * `input.expectedUpdatedAt` is the version the edit is based on: if the campaign changed since, the
 * database writes nothing and this throws a `conflict` (409) with `CAMPAIGN_MESSAGES.staleVersion`.
 */
export async function updateCampaignGeneral(
	supabase: SupabaseClient,
	id: string,
	input: CampaignGeneralInput,
	ctx: CampaignRequestContext = {}
): Promise<boolean> {
	const data = await callCampaignRpc(
		supabase,
		'campaign_update',
		{
			p_id: id,
			p_name: input.name,
			p_starts_at: input.startsAt,
			p_ends_at: input.endsAt,
			// The exact string as loaded (microseconds); the database compares it with updated_at.
			p_expected_updated_at: input.expectedUpdatedAt,
			p_request_id: ctx.requestId ?? null
		},
		ctx
	);
	return data === true;
}

/**
 * Updates the rules of a draft campaign (`campaign.update_rules`). The installment value is
 * recomputed by the database; the optional `reason` is stored in the audit row. Returns false
 * when nothing changed (no audit row). Throws a `conflict` (409) when the campaign changed since
 * `input.expectedUpdatedAt` (nothing written).
 */
export async function updateCampaignRules(
	supabase: SupabaseClient,
	id: string,
	input: CampaignRulesInput & { reason?: CampaignRulesUpdateInput['reason'] },
	ctx: CampaignRequestContext = {}
): Promise<boolean> {
	const data = await callCampaignRpc(
		supabase,
		'campaign_update_rules',
		{
			p_id: id,
			p_simple_bond_value: input.simpleBondValue,
			p_installment_count: input.installmentCount,
			p_number_digits: input.numberDigits,
			p_max_number: input.maxNumber,
			p_associated_number_offset: input.associatedNumberOffset,
			p_overflow_policy: input.overflowPolicy,
			p_barcode_mode: input.barcodeMode,
			// Full replacement: null clears the pattern.
			p_barcode_pattern: input.barcodePattern,
			p_expected_updated_at: input.expectedUpdatedAt,
			p_request_id: ctx.requestId ?? null,
			p_reason: input.reason ?? null
		},
		ctx
	);
	return data === true;
}

/**
 * Changes the campaign status. Activation requires `campaign.update_rules`; closing and annulling
 * require `campaign.close` (annulling also a reason). Checked by the database.
 */
export async function transitionCampaign(
	supabase: SupabaseClient,
	id: string,
	input: CampaignTransitionInput,
	ctx: CampaignRequestContext = {}
): Promise<void> {
	await callCampaignRpc(
		supabase,
		'campaign_transition',
		{
			p_id: id,
			p_to_status: input.toStatus,
			p_reason: input.reason,
			p_request_id: ctx.requestId ?? null
		},
		ctx
	);
}

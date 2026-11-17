import type { SupabaseClient } from '@supabase/supabase-js';
import {
	COMMISSION_RULE_STATUSES,
	COMMISSION_RULE_TYPES,
	compareCommissionRules,
	type CommissionRule,
	type CommissionRuleStatus,
	type CommissionRuleType
} from '$lib/domain/commissions';
import { toDecimalString } from '$lib/domain/money';
import { toPercentString } from '$lib/domain/percent';
import type { RepositoryResult } from './campaigns';

/**
 * Read access to `public.commission_rules` under the caller's RLS (`commission.view`). Writes go
 * through the audited `commission_rule_*` SQL functions (see services/commission-rules.ts).
 *
 * `percentage` (numeric(5,2)) and `fixed_amount` (numeric(14,2)) are selected with a `::text`
 * cast and kept as exact two-decimal strings.
 */
export const COMMISSION_RULE_COLUMNS = [
	'id',
	'campaign_id',
	'rule_type',
	'installment_number',
	'percentage::text',
	'fixed_amount::text',
	'applies_to_collector_id',
	'valid_from',
	'valid_to',
	'status',
	'annulled_at',
	'annulled_by',
	'annul_reason',
	'created_by',
	'created_at',
	'updated_at'
].join(', ');

export interface CommissionRuleRow {
	id: string;
	campaign_id: string;
	rule_type: string;
	installment_number: number | null;
	percentage: string | number | null;
	fixed_amount: string | number | null;
	applies_to_collector_id: string | null;
	valid_from: string;
	valid_to: string | null;
	status: string;
	annulled_at: string | null;
	annulled_by: string | null;
	annul_reason: string | null;
	created_by: string | null;
	created_at: string;
	updated_at: string;
}

function oneOf<T extends string>(allowed: readonly T[], value: string, column: string): T {
	if (!(allowed as readonly string[]).includes(value)) {
		throw new Error(`Unexpected commission_rules.${column} value: ${value}`);
	}
	return value as T;
}

/** Maps a database row to the app type. Throws on values the app does not know about. */
export function mapCommissionRuleRow(row: CommissionRuleRow): CommissionRule {
	return {
		id: row.id,
		campaignId: row.campaign_id,
		ruleType: oneOf<CommissionRuleType>(COMMISSION_RULE_TYPES, row.rule_type, 'rule_type'),
		installmentNumber: row.installment_number,
		percentage: row.percentage === null ? null : toPercentString(row.percentage),
		fixedAmount: row.fixed_amount === null ? null : toDecimalString(row.fixed_amount),
		appliesToCollectorId: row.applies_to_collector_id,
		validFrom: row.valid_from,
		validTo: row.valid_to,
		status: oneOf<CommissionRuleStatus>(COMMISSION_RULE_STATUSES, row.status, 'status'),
		annulledAt: row.annulled_at,
		annulledBy: row.annulled_by,
		annulReason: row.annul_reason,
		createdBy: row.created_by,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

/**
 * General rules (no collector) of one campaign visible to the caller, active first, then by type
 * and validity (see `compareCommissionRules`). `campaignId` must already be a valid uuid.
 */
export async function listGeneralCommissionRules(
	supabase: SupabaseClient,
	campaignId: string
): Promise<RepositoryResult<CommissionRule[]>> {
	const { data, error } = await supabase
		.from('commission_rules')
		.select(COMMISSION_RULE_COLUMNS)
		.eq('campaign_id', campaignId)
		.is('applies_to_collector_id', null)
		.order('valid_from', { ascending: true })
		.overrideTypes<CommissionRuleRow[], { merge: false }>();

	if (error) return { data: null, error };
	try {
		return {
			data: (data ?? []).map(mapCommissionRuleRow).sort(compareCommissionRules),
			error: null
		};
	} catch (err) {
		return { data: null, error: err as Error };
	}
}

/**
 * One rule by id, or `data: null` when it does not exist or is not visible to the caller.
 * `id` must already be a valid uuid.
 */
export async function getCommissionRuleById(
	supabase: SupabaseClient,
	id: string
): Promise<RepositoryResult<CommissionRule | null>> {
	const { data, error } = await supabase
		.from('commission_rules')
		.select(COMMISSION_RULE_COLUMNS)
		.eq('id', id)
		.maybeSingle()
		.overrideTypes<CommissionRuleRow | null, { merge: false }>();

	if (error) return { data: null, error };
	try {
		return { data: data ? mapCommissionRuleRow(data) : null, error: null };
	} catch (err) {
		return { data: null, error: err as Error };
	}
}

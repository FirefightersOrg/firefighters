/**
 * Commission rules (pure, no framework imports). Mirrors `public.commission_rules`
 * (migration `20261118000000_commission_rules.sql`, docs/commissions.md).
 */
import type { CampaignStatus } from './campaigns';
import { formatMoney } from './money';
import { formatPercent } from './percent';

export const COMMISSION_RULE_TYPES = [
	'cash_full_payment',
	'installment_first',
	'installment_middle',
	'installment_last',
	'custom'
] as const;
export type CommissionRuleType = (typeof COMMISSION_RULE_TYPES)[number];

export const COMMISSION_RULE_TYPE_LABELS: Record<CommissionRuleType, string> = {
	cash_full_payment: 'Cash (full payment)',
	installment_first: 'First installment',
	installment_middle: 'Middle installments',
	installment_last: 'Last installment',
	custom: 'Specific installment'
};

export const COMMISSION_RULE_TYPE_HINTS: Record<CommissionRuleType, string> = {
	cash_full_payment: 'The bond is paid in full at once.',
	installment_first: 'Payment of the first installment.',
	installment_middle: 'Payments of every installment between the first and the last.',
	installment_last: 'Payment of the last installment.',
	custom: 'Payment of one specific installment number.'
};

export const COMMISSION_RULE_STATUSES = ['active', 'annulled'] as const;
export type CommissionRuleStatus = (typeof COMMISSION_RULE_STATUSES)[number];

export const COMMISSION_VALUE_KINDS = ['percentage', 'fixed_amount'] as const;
export type CommissionValueKind = (typeof COMMISSION_VALUE_KINDS)[number];

/** App representation of a `commission_rules` row. Numbers are canonical two-decimal strings. */
export interface CommissionRule {
	id: string;
	campaignId: string;
	ruleType: CommissionRuleType;
	/** Only for `custom` rules (1..campaign installment count). */
	installmentNumber: number | null;
	/** Exactly one of `percentage` (`"12.50"`) and `fixedAmount` (`"1500.00"`) is set. */
	percentage: string | null;
	fixedAmount: string | null;
	/** null = general rule (special collector rules arrive in a later phase). */
	appliesToCollectorId: string | null;
	/** Calendar days (`YYYY-MM-DD`), both inclusive; `validTo` null = open-ended. */
	validFrom: string;
	validTo: string | null;
	status: CommissionRuleStatus;
	annulledAt: string | null;
	annulledBy: string | null;
	annulReason: string | null;
	createdBy: string | null;
	createdAt: string;
	updatedAt: string;
}

/** Commission rules can be created, edited and annulled while the campaign is draft or active. */
export function canManageCommissionRules(status: CampaignStatus): boolean {
	return status === 'draft' || status === 'active';
}

/** `"12,5 %"` or `"$ 1.500,00"` (es-AR). */
export function formatCommissionValue(
	rule: Pick<CommissionRule, 'percentage' | 'fixedAmount'>
): string {
	if (rule.percentage !== null) return formatPercent(rule.percentage);
	if (rule.fixedAmount !== null) return formatMoney(rule.fixedAmount);
	return '—';
}

/** Type label, with the installment for `custom` rules (`"Specific installment: #4"`). */
export function formatCommissionRuleType(
	rule: Pick<CommissionRule, 'ruleType' | 'installmentNumber'>
): string {
	const label = COMMISSION_RULE_TYPE_LABELS[rule.ruleType];
	return rule.ruleType === 'custom' && rule.installmentNumber !== null
		? `${label}: #${rule.installmentNumber}`
		: label;
}

/** Display format for a calendar day (`"2026-03-01"` → `"Mar 1, 2026"`), like campaign dates. */
export function formatDay(day: string): string {
	const ms = Date.parse(`${day}T00:00:00Z`);
	if (Number.isNaN(ms)) return day;
	return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(ms);
}

/** `"Mar 1, 2026 – Mar 31, 2026"` or `"From Mar 1, 2026"` (open-ended). */
export function formatValidity(rule: Pick<CommissionRule, 'validFrom' | 'validTo'>): string {
	return rule.validTo
		? `${formatDay(rule.validFrom)} – ${formatDay(rule.validTo)}`
		: `From ${formatDay(rule.validFrom)}`;
}

/** Where an active rule stands relative to `today` (`YYYY-MM-DD`). */
export type CommissionRuleTiming = 'upcoming' | 'current' | 'ended';

export function commissionRuleTiming(
	rule: Pick<CommissionRule, 'validFrom' | 'validTo'>,
	today: string
): CommissionRuleTiming {
	if (today < rule.validFrom) return 'upcoming';
	if (rule.validTo !== null && today > rule.validTo) return 'ended';
	return 'current';
}

/** Today's calendar day in Argentina (UTC-03:00, no DST), `YYYY-MM-DD`. */
export function todayInArgentina(now: Date = new Date()): string {
	return new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const TYPE_ORDER = new Map(COMMISSION_RULE_TYPES.map((type, index) => [type, index]));

/**
 * Display order: active rules first, then by type (cash, first, middle, last, specific
 * installment by number) and validity start.
 */
export function compareCommissionRules(a: CommissionRule, b: CommissionRule): number {
	return (
		Number(a.status === 'annulled') - Number(b.status === 'annulled') ||
		(TYPE_ORDER.get(a.ruleType) ?? 0) - (TYPE_ORDER.get(b.ruleType) ?? 0) ||
		(a.installmentNumber ?? 0) - (b.installmentNumber ?? 0) ||
		a.validFrom.localeCompare(b.validFrom) ||
		a.createdAt.localeCompare(b.createdAt)
	);
}

/**
 * Commission rules (pure, no framework imports). Mirrors `public.commission_rules`
 * (migration `20261118000000_commission_rules.sql`, docs/commissions.md).
 */
import type { CampaignStatus } from './campaigns';
import { formatDate, formatMoney } from '../format';
import { formatPercent } from './percent';

export const COMMISSION_RULE_TYPES = [
	'cash_full_payment',
	'installment_first',
	'installment_middle',
	'installment_last',
	'custom'
] as const;
export type CommissionRuleType = (typeof COMMISSION_RULE_TYPES)[number];

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

export interface CommissionApplication {
	collectorId: string;
	paymentDate: string;
	paymentMode: 'full_payment' | 'installments';
	installmentNumber: number;
	installmentCount: number;
	amountApplied: number;
	installmentAmount: number;
}

/** True when a rule covers the application; validity endpoints are inclusive. */
export function commissionRuleMatches(
	rule: CommissionRule,
	application: CommissionApplication
): boolean {
	if (
		rule.status !== 'active' ||
		(rule.appliesToCollectorId !== null && rule.appliesToCollectorId !== application.collectorId) ||
		application.paymentDate < rule.validFrom ||
		(rule.validTo !== null && application.paymentDate > rule.validTo)
	)
		return false;
	if (rule.ruleType === 'custom') return rule.installmentNumber === application.installmentNumber;
	if (rule.ruleType === 'cash_full_payment') return application.paymentMode === 'full_payment';
	if (rule.ruleType === 'installment_first')
		return application.paymentMode === 'installments' && application.installmentNumber === 1;
	if (rule.ruleType === 'installment_middle')
		return (
			application.paymentMode === 'installments' &&
			application.installmentNumber >= 2 &&
			application.installmentNumber <= application.installmentCount - 1
		);
	return (
		application.paymentMode === 'installments' &&
		application.installmentCount > 1 &&
		application.installmentNumber === application.installmentCount
	);
}

/** SQL precedence: collector-specific, custom, newest validFrom, then lexicographically newest id. */
export function selectCommissionRule(
	rules: readonly CommissionRule[],
	application: CommissionApplication
): CommissionRule | null {
	return (
		rules
			.filter((rule) => commissionRuleMatches(rule, application))
			.slice()
			.sort(
				(a, b) =>
					Number(b.appliesToCollectorId !== null) - Number(a.appliesToCollectorId !== null) ||
					Number(b.ruleType === 'custom') - Number(a.ruleType === 'custom') ||
					b.validFrom.localeCompare(a.validFrom) ||
					b.id.localeCompare(a.id)
			)[0] ?? null
	);
}

/**
 * Preview only: binary floating-point rounding may differ at half-cent boundaries.
 * PostgreSQL numeric `round(..., 2)` in settlement_application_commission is authoritative
 * for persisted settlement totals and ledger entries; never post this preview as money.
 */
export function calculateApplicationCommission(
	rules: readonly CommissionRule[],
	application: CommissionApplication
): number {
	const rule = selectCommissionRule(rules, application);
	if (!rule) return 0;
	const raw =
		rule.percentage !== null
			? (application.amountApplied * Number(rule.percentage)) / 100
			: (application.amountApplied * Number(rule.fixedAmount)) / application.installmentAmount;
	return Math.round((raw + Number.EPSILON) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Spanish display (docs/copy.md).
// ---------------------------------------------------------------------------

export const COMMISSION_RULE_TYPE_LABELS: Record<CommissionRuleType, string> = {
	cash_full_payment: 'Pago al contado',
	installment_first: 'Primera cuota',
	installment_middle: 'Cuotas intermedias',
	installment_last: 'Última cuota',
	custom: 'Cuota específica'
};

export const COMMISSION_RULE_TYPE_HINTS: Record<CommissionRuleType, string> = {
	cash_full_payment: 'El bono se paga completo en un solo pago.',
	installment_first: 'Pago de la primera cuota.',
	installment_middle: 'Pagos de todas las cuotas entre la primera y la última.',
	installment_last: 'Pago de la última cuota.',
	custom: 'Pago de un número de cuota específico.'
};

/** `"12,5 %"` or `"$ 1.500"`; an em dash when the rule has neither. */
export function describeCommissionValue(
	rule: Pick<CommissionRule, 'percentage' | 'fixedAmount'>
): string {
	if (rule.percentage !== null) return formatPercent(rule.percentage);
	if (rule.fixedAmount !== null) return formatMoney(rule.fixedAmount);
	return '—';
}

/** Type label, with the installment for `custom` rules (`"Cuota específica: #4"`). */
export function describeCommissionRuleType(
	rule: Pick<CommissionRule, 'ruleType' | 'installmentNumber'>
): string {
	const label = COMMISSION_RULE_TYPE_LABELS[rule.ruleType];
	return rule.ruleType === 'custom' && rule.installmentNumber !== null
		? `${label}: #${rule.installmentNumber}`
		: label;
}

/** `"01/03/2026 – 31/03/2026"` or `"Desde el 01/03/2026"` (open-ended). */
export function describeValidity(rule: Pick<CommissionRule, 'validFrom' | 'validTo'>): string {
	const from = formatDate(rule.validFrom, { fallback: rule.validFrom });
	if (!rule.validTo) return `Desde el ${from}`;
	return `${from} – ${formatDate(rule.validTo, { fallback: rule.validTo })}`;
}

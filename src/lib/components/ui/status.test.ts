import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { BOND_COMMERCIAL_STATUSES, BOND_COMMERCIAL_STATUS_LABELS } from '$lib/domain/bonds';
import { BOND_FINANCIAL_STATUSES, BOND_FINANCIAL_STATUS_LABELS } from '$lib/domain/bonds';
import { CAMPAIGN_STATUSES, CAMPAIGN_STATUS_LABELS } from '$lib/domain/campaigns';
import { COMMISSION_RULE_STATUSES } from '$lib/domain/commissions';
import { ASSIGNMENT_STATUSES } from '$lib/domain/deliveries';
import {
	DRAW_ROSTER_STATUSES,
	DRAW_ROSTER_STATUS_LABELS,
	DRAW_STATUSES,
	DRAW_STATUS_LABELS
} from '$lib/domain/draws';
import {
	IMPORT_ITEM_STATUS_LABELS,
	IMPORT_SESSION_STATUS_LABELS
} from '$lib/domain/import-preview';
import { IMPORT_ITEM_STATUSES, IMPORT_SESSION_STATUSES } from '$lib/domain/imports';
import { LEDGER_STATUSES, LEDGER_STATUS_LABELS } from '$lib/domain/ledger';
import { COLLECTOR_STATUSES, COLLECTOR_STATUS_LABELS } from '$lib/domain/parties';
import {
	PAYMENT_STATUSES,
	PAYMENT_STATUS_LABELS,
	SETTLEMENT_STATUSES,
	SETTLEMENT_STATUS_LABELS
} from '$lib/domain/payments';
import {
	INSTALLMENT_STATUSES,
	INSTALLMENT_STATUS_LABELS,
	PAYMENT_PLAN_STATUSES,
	SALE_STATUSES,
	SALE_STATUS_LABELS
} from '$lib/domain/sales';
import StatusBadge from './StatusBadge.svelte';
import { STATUS_MAP, statusMeta, type StatusKind } from './status';
import { TONES } from './tones';

/** Every status of each kind, taken from the domain modules and the DB CHECK constraints. */
const EXPECTED: Record<StatusKind, readonly string[]> = {
	campaign: CAMPAIGN_STATUSES,
	bondCommercial: BOND_COMMERCIAL_STATUSES,
	bondFinancial: BOND_FINANCIAL_STATUSES,
	importSession: [...IMPORT_SESSION_STATUSES, 'rolled_back'],
	importItem: [...IMPORT_ITEM_STATUSES, 'removed'],
	sale: SALE_STATUSES,
	paymentPlan: PAYMENT_PLAN_STATUSES,
	installment: INSTALLMENT_STATUSES,
	payment: PAYMENT_STATUSES,
	settlement: SETTLEMENT_STATUSES,
	ledger: LEDGER_STATUSES,
	collector: COLLECTOR_STATUSES,
	assignment: ASSIGNMENT_STATUSES,
	deliveryNote: ['issued', 'annulled'],
	commissionRule: COMMISSION_RULE_STATUSES,
	draw: DRAW_STATUSES,
	roster: DRAW_ROSTER_STATUSES,
	// supabase/migrations/*_prizes.sql CHECK constraints
	prize: [
		'pending_validation',
		'awarded',
		'pending_delivery',
		'delivered',
		'unawarded',
		'annulled'
	],
	winningNumber: ['pending_review', 'eligible_winner', 'not_eligible', 'no_match'],
	prizeAward: ['awarded', 'delivered', 'annulled']
};

describe('STATUS_MAP', () => {
	it('covers every status of every kind, and nothing else', () => {
		expect(Object.keys(STATUS_MAP).sort()).toEqual(Object.keys(EXPECTED).sort());
		for (const [kind, statuses] of Object.entries(EXPECTED)) {
			expect(Object.keys(STATUS_MAP[kind as StatusKind]).sort(), kind).toEqual(
				[...statuses].sort()
			);
		}
	});

	it('gives each status a valid tone and a non-empty Spanish label', () => {
		for (const [kind, statuses] of Object.entries(STATUS_MAP)) {
			for (const [status, meta] of Object.entries(statuses)) {
				expect(TONES, `${kind}.${status}`).toContain(meta.tone);
				expect(meta.label.trim(), `${kind}.${status}`).not.toBe('');
				// Spanish, not the English enum value.
				expect(meta.label.toLowerCase()).not.toBe(status);
			}
		}
	});

	it('keeps the domain label constants identical to the map labels', () => {
		const pairs: [StatusKind, Record<string, string>][] = [
			['campaign', CAMPAIGN_STATUS_LABELS],
			['bondCommercial', BOND_COMMERCIAL_STATUS_LABELS],
			['bondFinancial', BOND_FINANCIAL_STATUS_LABELS],
			['importSession', IMPORT_SESSION_STATUS_LABELS],
			['importItem', IMPORT_ITEM_STATUS_LABELS],
			['sale', SALE_STATUS_LABELS],
			['installment', INSTALLMENT_STATUS_LABELS],
			['payment', PAYMENT_STATUS_LABELS],
			['settlement', SETTLEMENT_STATUS_LABELS],
			['ledger', LEDGER_STATUS_LABELS],
			['collector', COLLECTOR_STATUS_LABELS],
			['draw', DRAW_STATUS_LABELS],
			['roster', DRAW_ROSTER_STATUS_LABELS]
		];
		for (const [kind, labels] of pairs) {
			for (const [status, label] of Object.entries(labels)) {
				expect(statusMeta(kind, status as never).label, `${kind}.${status}`).toBe(label);
			}
		}
	});

	it('follows the suggested tones', () => {
		expect(statusMeta('campaign', 'draft').tone).toBe('neutral');
		expect(statusMeta('campaign', 'active').tone).toBe('success');
		expect(statusMeta('campaign', 'closing').tone).toBe('warning');
		expect(statusMeta('campaign', 'closed').tone).toBe('info');
		expect(statusMeta('campaign', 'annulled').tone).toBe('danger');
		expect(statusMeta('payment', 'pending_in_settlement').tone).toBe('warning');
		expect(statusMeta('importItem', 'error').tone).toBe('danger');
	});
});

describe('StatusBadge', () => {
	it('renders the label and the dot for every status (never color alone)', () => {
		for (const [kind, statuses] of Object.entries(STATUS_MAP)) {
			for (const [status, meta] of Object.entries(statuses)) {
				const { body } = render(StatusBadge, {
					props: { kind: kind as never, status: status as never }
				});
				expect(body, `${kind}.${status}`).toContain(meta.label);
				expect(body).toContain(`data-tone="${meta.tone}"`);
				expect(body).toContain('aria-hidden="true"');
			}
		}
	});
});

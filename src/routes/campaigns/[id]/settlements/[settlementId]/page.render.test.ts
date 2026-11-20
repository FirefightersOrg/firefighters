/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';
const id = 'c',
	settlement = {
		id: 's',
		settlementNumber: 1,
		collectorName: 'Ana',
		openedAt: '2026-01-01T02:59:59Z',
		status: 'open'
	};
const totals = {
	totalCash: '1.00',
	totalTransfer: '2.00',
	totalAmount: '3.00',
	commissionAmount: '0.00',
	commissionPaidAmount: '0.00',
	netToFirefighters: '3.00',
	collectorCreditBalance: '0.00'
};
const page = (status = 'open') =>
	render(Page, {
		props: {
			data: {
				campaign: { id },
				settlement: { ...settlement, status },
				totals,
				payments: [
					{ id: 'p', date: '2026-01-01', amount: '3.00', method: 'cash', status: 'confirmed' }
				],
				candidates: [],
				reasonMax: 2000,
				can: { add: status === 'open', remove: status === 'open', close: status === 'open' }
			},
			params: { id, settlementId: 's' }
		} as any
	}).body;
describe('settlement workspace render', () => {
	it('renders seven metrics and open forms', () => {
		const body = page();
		expect(body.match(/tabular-nums/g)).toHaveLength(7);
		expect(body).toContain('?/add');
		expect(body).toContain('?/remove');
		expect(body).toContain('?/close');
		expect(body).toContain('Dec 31, 2025');
		// Native maxlength counts UTF-16 units, unlike the database's code-point limit.
		expect(body).not.toContain('maxlength=');
	});
	it('renders closed documents read-only', () => {
		const body = page('closed');
		expect(body).toContain('/settlements/s/print');
		expect(body).toContain('/payments/p/print');
		expect(body).not.toContain('?/add');
		expect(body).not.toContain('?/close');
	});
	it('does not print certificates for unconfirmed payments', () => {
		const body = render(Page, {
			props: {
				data: {
					campaign: { id },
					settlement: { ...settlement, status: 'closed' },
					totals,
					payments: [{ id: 'p', date: '', amount: '1.00', method: 'cash', status: 'annulled' }],
					candidates: [],
					reasonMax: 1,
					can: { add: false, remove: false, close: false }
				},
				params: { id, settlementId: 's' }
			} as any
		}).body;
		expect(body).not.toContain('/payments/p/print');
	});
});

describe('settlement workspace corrections (SAN-73)', () => {
	const closed = (can: Record<string, boolean>) =>
		render(Page, {
			props: {
				data: {
					campaign: { id },
					settlement: { ...settlement, status: 'closed' },
					totals,
					payments: [
						{ id: 'p', date: '2026-01-01', amount: '3.00', method: 'cash', status: 'confirmed' }
					],
					candidates: [],
					reasonMax: 1000,
					can: { add: false, remove: false, close: false, ...can }
				},
				params: { id, settlementId: 's' }
			} as any
		}).body;

	it('shows payment correction forms with the indicative ledger preview only with permission', () => {
		const allowed = closed({ correctPayment: true });
		expect(allowed).toContain('?/annulPayment');
		expect(allowed).toContain('Indicative preview');
		const denied = closed({ correctPayment: false });
		expect(denied).not.toContain('?/annulPayment');
		expect(denied).not.toContain('Indicative preview');
	});

	it('shows the settlement correction with its ledger preview only with settlement.correct', () => {
		const allowed = closed({ correctSettlement: true });
		expect(allowed).toContain('Indicative ledger preview');
		expect(allowed).toContain('name="commissionDelta"');
		expect(closed({ correctSettlement: false })).not.toContain('Indicative ledger preview');
	});
});

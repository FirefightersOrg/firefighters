import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';
import { mapCampaignRow } from '$lib/server/repositories/campaigns';
import { CAMPAIGN_ID, campaignRow } from '../../../campaigns/test-helpers';

const entries = [
	{
		id: 'e3',
		occurredAt: '2026-11-19T12:00:00Z',
		entryType: 'adjustment_in_favor_of_collector',
		direction: 'collector_credit',
		amount: 2.5,
		status: 'recorded',
		settlementId: null,
		settlementNumber: null,
		affectsBalance: false,
		runningBalance: 17.5,
		adjustmentReason: 'Bonus <b>por</b> cobranza extraordinaria'
	},
	{
		id: 'e2',
		occurredAt: '2026-11-19T11:00:00Z',
		entryType: 'adjustment_in_favor_of_firefighters',
		direction: 'collector_debit',
		amount: 4,
		status: 'annulled',
		settlementId: null,
		settlementNumber: null,
		runningBalance: 15,
		adjustmentReason: null
	},
	{
		id: 'e1',
		occurredAt: '2026-11-19T10:00:00Z',
		entryType: 'commission_generated',
		direction: 'collector_credit',
		amount: 15,
		status: 'recorded',
		settlementId: 's1',
		settlementNumber: 7,
		runningBalance: 15,
		adjustmentReason: null
	}
];
const settlements = [
	{
		id: 's1',
		number: 7,
		status: 'closed',
		openedAt: '2026-11-18T10:00:00Z',
		closedAt: '2026-11-19T10:00:00Z',
		totalAmount: 1000,
		commissionAmount: 150,
		commissionPaidAmount: 0,
		netToFirefighters: 850
	}
];

function page(ledger: unknown) {
	return render(Page, {
		props: {
			data: {
				collector: { id: 'c1', displayName: 'Ada', status: 'active' },
				campaign: mapCampaignRow(campaignRow()),
				ledger
			},
			params: { campaignId: CAMPAIGN_ID }
		} as never
	}).body;
}

const full = (overrides = {}) => ({
	summary: {
		balance: 17.5,
		commissionGenerated: 15,
		commissionAdjusted: 2.5,
		commissionSettled: 0,
		commissionAnnulments: 0,
		otherMovements: 0,
		entryCount: 3
	},
	entries,
	total: 3,
	page: 1,
	pageCount: 1,
	settlements,
	settlementsTotal: 1,
	...overrides
});

describe('Mi cuenta corriente page', () => {
	it('renders the balance, commission summary, entries and settlements', () => {
		const body = page(full());
		expect(body).toMatch(/data-testid="ledger-balance"[\s\S]*\$.17,50/);
		// The balance comes first, in words: who it is in favour of (UX plan PR 11).
		expect(body).toContain('Saldo a favor del cobrador');
		expect(body).toContain('Suma los movimientos que no están anulados.');
		expect(body.indexOf('data-testid="ledger-balance"')).toBeLessThan(body.indexOf('<table'));
		expect(body).toContain('Comisiones generadas');
		expect(body).toContain('Liquidadas');
		expect(body).toContain('Anulaciones y correcciones');
		for (const column of ['Fecha', 'Concepto', 'Débito', 'Crédito', 'Saldo', 'Estado'])
			expect(body).toMatch(new RegExp(`>\\s*${column}\\s*</th>`));
		expect(body).toContain('19/11/2026');
		expect(body).toContain('Rendición N.º 7');
		expect(body).toContain('Historial de rendiciones');
		expect(body).toContain('Cerrada');
	});

	it('says whose favour the balance is in, without a sign on the figure', () => {
		const summary = full().summary;
		const against = page(full({ summary: { ...summary, balance: -17.5 } }));
		expect(against).toContain('Saldo a cargo del cobrador');
		expect(against).toMatch(/data-testid="ledger-balance"[\s\S]*?\$.17,50/);
		expect(against).not.toMatch(/data-testid="ledger-balance"[\s\S]{0,400}-\$/);
		expect(page(full({ summary: { ...summary, balance: 0 } }))).toContain('Sin saldo');
	});

	it('stacks movements and settlements on a phone, with one signed amount per movement', () => {
		const body = page(full());
		expect(body.match(/max-\[719px\]:/g)?.length).toBeGreaterThan(4);
		expect(body).toMatch(/min-\[720px\]:hidden[^>]*>\s*(?:<!--.*?-->)*(−\u00a0)?\$/);
	});

	it('shows annulled entries struck through and does not leak notes', () => {
		const body = page(full());
		expect(body).toContain('Anulado');
		expect(body).toContain('line-through');
		expect(body).not.toContain('Motivo interno');
	});

	it('shows the adjustment reason escaped, and no text for an adjustment without one', () => {
		const body = page(full());
		expect(body).toContain('Motivo: ');
		expect(body).toContain('Bonus &lt;b>por&lt;/b> cobranza extraordinaria');
		expect(body).not.toContain('<b>por</b>');
		expect(body.match(/data-testid="adjustment-reason"/g)).toHaveLength(1);
		expect(body).not.toMatch(/undefined|null/);
	});

	it('marks reference entries as not changing the balance', () => {
		expect(page(full())).toContain('Referencia: no cambia el saldo.');
	});

	it('shows pagination links only when there is more than one page', () => {
		expect(page(full())).not.toContain('Paginación');
		const body = page(full({ page: 2, pageCount: 3, total: 60 }));
		expect(body).toContain('Página 2 de 3');
		expect(body).toContain('?page=1');
		expect(body).toContain('?page=3');
	});

	it('renders empty states', () => {
		const body = page(
			full({
				entries: [],
				total: 0,
				settlements: [],
				settlementsTotal: 0,
				summary: {
					balance: 0,
					commissionGenerated: 0,
					commissionAdjusted: 0,
					commissionSettled: 0,
					commissionAnnulments: 0,
					otherMovements: 0,
					entryCount: 0
				}
			})
		);
		expect(body).toContain('Sin saldo');
		expect(body).toContain('Todavía no hay movimientos');
		expect(body).toContain('Todavía no hay rendiciones');
	});

	it('renders the unlinked state without a ledger', () => {
		expect(page(null)).toContain('todavía no está vinculado a un cobrador');
	});
});

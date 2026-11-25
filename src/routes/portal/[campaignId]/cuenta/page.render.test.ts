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
		runningBalance: 17.5
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
		runningBalance: 15
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
		runningBalance: 15
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
		expect(body).toContain('Comisiones');
		expect(body).toContain('Generadas');
		expect(body).toContain('Liquidadas');
		for (const column of ['Fecha', 'Concepto', 'Débito', 'Crédito', 'Saldo', 'Estado'])
			expect(body).toMatch(new RegExp(`>\\s*${column}\\s*</th>`));
		expect(body).toContain('19/11/2026');
		expect(body).toContain('Rendición N.º 7');
		expect(body).toContain('Historial de rendiciones');
		expect(body).toContain('Cerrada');
	});

	it('shows annulled entries struck through and does not leak notes', () => {
		const body = page(full());
		expect(body).toContain('Anulado');
		expect(body).toContain('line-through');
		expect(body).not.toContain('Motivo');
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
					entryCount: 0
				}
			})
		);
		expect(body).toContain('Todavía no hay movimientos');
		expect(body).toContain('Todavía no hay rendiciones');
	});

	it('renders the unlinked state without a ledger', () => {
		expect(page(null)).toContain('todavía no está vinculado a un cobrador');
	});
});

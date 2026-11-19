import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page@.svelte';
import type { PageProps } from './$types';
const document = {
	institutionName: 'Bomberos Test',
	campaign: 'Bono 2027',
	settlementNumberLabel: 'Settlement 0007',
	status: 'open' as const,
	openedAt: '',
	closedAt: null,
	openingDate: '18/11/26, 12:30',
	closingDate: '—',
	collector: 'Ana Pérez',
	closedBy: null,
	notes: 'Cash box',
	preliminary: true,
	manualAdjustments: '0 — No manual adjustments have been recorded.',
	collectorSignature: 'Collector signature',
	administrationSignature: 'Administration signature',
	totals: {
		cash: '$ 100,00',
		transfer: '$ 50,00',
		amount: '$ 150,00',
		commission: '$ 10,00',
		commissionPaid: '$ 10,00',
		net: '$ 140,00',
		balance: '$ 0,00'
	},
	payments: [
		{
			bond: '0068',
			buyer: 'Buyer',
			installments: 'Installment 1',
			method: 'Cash',
			amount: '$ 100,00'
		}
	]
};
describe('settlement delivery note print page', () => {
	it('renders all required fields twice including payment rows and signatures', () => {
		const body = render(Page, {
			props: { data: { document }, params: {} } as unknown as PageProps
		}).body;
		for (const text of [
			'ORIGINAL – Administration',
			'DUPLICATE – Collector',
			'Bomberos Test',
			'Bono 2027',
			'Settlement 0007',
			'18/11/26, 12:30',
			'Ana Pérez',
			'0068',
			'Buyer',
			'Installment 1',
			'Cash',
			'Cash total',
			'Transfer total',
			'Grand total',
			'Generated commission',
			'Settled commission',
			'Manual adjustments',
			'Net for Firefighters',
			'Resulting collector balance',
			'Cash box'
		])
			expect(body).toContain(text);
		expect(body.split('Collector signature').length - 1).toBe(2);
		expect(body.split('Administration signature').length - 1).toBe(2);
	});
	it('shows the preliminary label for an open settlement', () => {
		const body = render(Page, {
			props: { data: { document }, params: {} } as unknown as PageProps
		}).body;
		expect(body.split('PRELIMINARY / DRAFT — OPEN SETTLEMENT').length - 1).toBe(2);
	});
	it.each([
		['annulled', 'ANULADA'],
		['corrected', 'CORREGIDA']
	] as const)('marks both copies of a %s settlement as invalid', (status, label) => {
		const body = render(Page, {
			props: {
				data: { document: { ...document, status, preliminary: false } },
				params: {}
			} as unknown as PageProps
		}).body;
		expect(body.split(label).length - 1).toBe(2);
		expect(body.split('NOT VALID').length - 1).toBe(2);
		expect(body).not.toContain('PRELIMINARY / DRAFT');
	});
	it('does not mark closed settlements as drafts or invalid', () => {
		const body = render(Page, {
			props: {
				data: { document: { ...document, status: 'closed', preliminary: false } },
				params: {}
			} as unknown as PageProps
		}).body;
		expect(body).not.toContain('NOT VALID');
		expect(body).not.toContain('PRELIMINARY / DRAFT');
	});
});

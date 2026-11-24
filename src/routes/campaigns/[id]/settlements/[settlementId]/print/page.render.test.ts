import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page@.svelte';
import type { PageProps } from './$types';
const document = {
	institutionName: 'Bomberos Test',
	campaign: 'Bono 2027',
	settlementNumberLabel: 'Rendición 0007',
	status: 'open' as const,
	openedAt: '',
	closedAt: null,
	openingDate: '18/11/26, 12:30',
	closingDate: '—',
	collector: 'Ana Pérez',
	closedBy: null,
	notes: 'Caja de efectivo',
	preliminary: true,
	manualAdjustments: '0 — No se registraron ajustes manuales.',
	collectorSignature: 'Firma del cobrador',
	administrationSignature: 'Firma de la administración',
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
			buyer: 'Comprador',
			installments: 'Cuota 1',
			method: 'Efectivo',
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
			'ORIGINAL – Administración',
			'DUPLICADO – Cobrador',
			'Bomberos Test',
			'Bono 2027',
			'Rendición 0007',
			'18/11/26, 12:30',
			'Ana Pérez',
			'0068',
			'Comprador',
			'Cuota 1',
			'Efectivo',
			'Total en efectivo',
			'Total por transferencia',
			'Total general',
			'Comisión generada',
			'Comisión liquidada',
			'Ajustes manuales',
			'Neto para Bomberos',
			'Saldo resultante del cobrador',
			'Caja de efectivo'
		])
			expect(body).toContain(text);
		expect(body.split('Firma del cobrador').length - 1).toBe(2);
		expect(body.split('Firma de la administración').length - 1).toBe(2);
	});
	it('shows the preliminary label for an open settlement', () => {
		const body = render(Page, {
			props: { data: { document }, params: {} } as unknown as PageProps
		}).body;
		expect(body.split('PRELIMINAR / BORRADOR — RENDICIÓN ABIERTA').length - 1).toBe(2);
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
		expect(body.split('SIN VALIDEZ').length - 1).toBe(2);
		expect(body).not.toContain('PRELIMINAR / BORRADOR');
	});
	it('does not mark closed settlements as drafts or invalid', () => {
		const body = render(Page, {
			props: {
				data: { document: { ...document, status: 'closed', preliminary: false } },
				params: {}
			} as unknown as PageProps
		}).body;
		expect(body).not.toContain('SIN VALIDEZ');
		expect(body).not.toContain('PRELIMINAR / BORRADOR');
	});
});

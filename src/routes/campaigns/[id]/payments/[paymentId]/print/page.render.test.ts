import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page@.svelte';
describe('payment certificate print page', () => {
	it('renders all 12 required fields including padded bond and receipt number', () => {
		const document = {
			institutionName: 'Bomberos Test',
			campaign: 'Bono 2027',
			receiptNumber: 'SET-0007-12345678',
			bond: '00068',
			buyer: 'Comprador',
			collector: 'Ana Pérez',
			installments: 'Cuota 1',
			amount: '$ 100,00',
			method: 'Efectivo',
			paymentDate: '18/11/26',
			createdAt: '18/11/26, 12:30',
			registeredBy: 'Operator',
			id: '12345678',
			settlementNumber: 7,
			legend: null
		};
		const body = render(Page, {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal PageProps for SSR
			props: { data: { document }, params: {} } as any
		}).body;
		for (const text of [
			'Bomberos Test',
			'Bono 2027',
			'SET-0007-12345678',
			'00068',
			'Comprador',
			'Ana Pérez',
			'Cuota 1',
			'$ 100,00',
			'Efectivo',
			'18/11/26',
			'Operator',
			'Fecha de registro'
		])
			expect(body).toContain(text);
	});

	it.each([
		['ANULADO — COMPROBANTE SIN VALIDEZ', null],
		['CORREGIDO — VER REFERENCIA', 'Comprobante relacionado: PAY-ABCDEF12']
	])('renders legend label and value %s', (label, reference) => {
		const document = {
			institutionName: 'Cimiento',
			campaign: 'Campaña',
			receiptNumber: 'PAY-12345678',
			bond: '00068',
			buyer: 'Comprador',
			collector: 'Cobrador',
			installments: 'Cuota 1',
			amount: '$ 100,00',
			method: 'Efectivo',
			paymentDate: '18/11/2026',
			createdAt: '18/11/2026, 12:30',
			registeredBy: 'Operador',
			id: '12345678',
			settlementNumber: 7,
			legend: {
				label,
				detail: '18/11/2026, 23:30 — Ana Pérez. Motivo: Corrección documentada',
				reference
			}
		};
		const body = render(Page, {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal PageProps for SSR
			props: { data: { document }, params: {} } as any
		}).body;
		expect(body).toContain(label);
		expect(body).toContain('Corrección documentada');
		if (reference) expect(body).toContain(reference);
	});
});

import { describe, expect, it } from 'vitest';
import { buildPrintablePaymentCertificate } from './payment-certificate';
const campaign = {
	id: 'c',
	name: 'Bono 2027',
	status: 'active',
	startsAt: null,
	endsAt: null,
	simpleBondValue: '1.00',
	installmentCount: 1,
	installmentValue: '1.00',
	numberDigits: 5,
	maxNumber: 99999,
	associatedNumberOffset: 1,
	overflowPolicy: 'reject',
	barcodeMode: 'base_number',
	barcodePattern: null,
	createdBy: null,
	createdAt: '2026-01-01T00:00:00Z',
	updatedAt: '2026-01-01T00:00:00Z'
} as const;
describe('buildPrintablePaymentCertificate', () => {
	it('formats all certificate fields and stable receipt id', () => {
		const doc = buildPrintablePaymentCertificate(
			campaign,
			{
				id: '12345678-0000-0000-0000-000000000000',
				bond: '00068',
				buyer: 'Buyer',
				collector: 'Ana',
				installments: 'Cuota 1',
				amount: '100.00',
				method: 'Efectivo',
				paymentDate: '2026-11-18',
				createdAt: '2026-11-18T15:30:00Z',
				registeredBy: 'Operator',
				settlementNumber: 7,
				legend: null
			},
			'Bomberos Test'
		);
		expect(doc).toMatchObject({
			campaign: 'Bono 2027',
			bond: '00068',
			amount: '$ 100,00',
			paymentDate: '18/11/2026',
			createdAt: expect.stringContaining('18/11/2026, 12:30'),
			receiptNumber: 'SET-0007-12345678'
		});
		expect(doc.paymentDate).not.toMatch(/\d{1,2}:\d{2}/);
	});

	it.each([
		[
			'annulled',
			{
				kind: 'annulled' as const,
				eventAt: '2026-11-19T02:30:00Z',
				actor: 'Ana Pérez',
				reason: 'Pago duplicado',
				relatedPaymentId: null,
				correctionType: 'annul'
			},
			'ANULADO — COMPROBANTE SIN VALIDEZ'
		],
		[
			'corrected',
			{
				kind: 'corrected' as const,
				eventAt: '2026-11-19T02:30:00Z',
				actor: 'Ana Pérez',
				reason: 'Medio incorrecto',
				relatedPaymentId: 'abcdef12-0000-0000-0000-000000000000',
				correctionType: 'correct_method'
			},
			'CORREGIDO — VER REFERENCIA'
		]
	])('formats the %s legend in Buenos Aires', (_kind, legend, label) => {
		const doc = buildPrintablePaymentCertificate(
			campaign,
			{
				id: '12345678-0000-0000-0000-000000000000',
				bond: '68',
				buyer: 'Buyer',
				collector: 'Ana',
				installments: 'Cuota 1',
				amount: '100.00',
				method: 'Efectivo',
				paymentDate: '2026-11-18',
				createdAt: '2026-11-18T15:30:00Z',
				registeredBy: 'Operator',
				settlementNumber: 7,
				legend
			},
			'Bomberos Test'
		);
		expect(doc.legend).toMatchObject({
			label,
			detail: expect.stringContaining('Ana Pérez')
		});
		expect(doc.legend?.detail).toContain('18/11/2026, 23:30');
	});
});

import { describe, expect, it } from 'vitest';
import { buildPrintableSettlementDeliveryNote } from './settlement-delivery-note';
const campaign = {
	id: 'c',
	name: 'Bono 2027',
	status: 'active',
	startsAt: null,
	endsAt: null,
	simpleBondValue: '1.00',
	installmentCount: 1,
	installmentValue: '1.00',
	numberDigits: 4,
	maxNumber: 9999,
	associatedNumberOffset: 1,
	associatedNumberMode: 'linear',
	overflowPolicy: 'reject',
	barcodeMode: 'base_number',
	barcodePattern: null,
	createdBy: null,
	createdAt: '2026-01-01T00:00:00Z',
	updatedAt: '2026-01-01T00:00:00Z'
} as const;
describe('buildPrintableSettlementDeliveryNote', () =>
	it('fills the settlement fields and labels an open note preliminary', () => {
		const doc = buildPrintableSettlementDeliveryNote(
			campaign,
			{
				settlementNumber: 7,
				status: 'open',
				openedAt: '2026-11-18T15:30:00Z',
				closedAt: null,
				collector: 'Ana',
				closedBy: null,
				notes: 'Cash box',
				totals: {
					cash: '100.00',
					transfer: '50.00',
					amount: '150.00',
					commission: '10.00',
					commissionPaid: '10.00',
					net: '140.00',
					balance: '0.00'
				},
				payments: [
					{
						bond: '0068',
						buyer: 'Comprador',
						installments: 'Cuota 1',
						method: 'Efectivo',
						amount: '100.00'
					}
				]
			},
			'Bomberos Test'
		);
		expect(doc).toMatchObject({
			campaign: 'Bono 2027',
			settlementNumberLabel: 'Rendición 0007',
			preliminary: true,
			manualAdjustments: '0 — No se registraron ajustes manuales.',
			collectorSignature: 'Firma del cobrador'
		});
		expect(doc.totals.amount).toBe('$ 150,00');
	}));

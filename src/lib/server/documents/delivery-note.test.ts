import { formatDateTime } from '$lib/format';
import { describe, expect, it } from 'vitest';
import type { Campaign } from '$lib/domain/campaigns';
import type { DeliveryNote } from '$lib/domain/deliveries';
import type { DeliveryNoteBond } from '$lib/server/repositories/deliveries';
import { buildPrintableDeliveryNote } from './delivery-note';

const campaign = (digits: 4 | 5): Campaign => ({
	id: 'c',
	name: 'Bono 2027',
	status: 'active',
	startsAt: null,
	endsAt: null,
	simpleBondValue: '60000.00',
	installmentCount: 10,
	installmentValue: '6000.00',
	numberDigits: digits,
	maxNumber: digits === 4 ? 9999 : 99999,
	associatedNumberOffset: digits === 4 ? 4871 : 48710,
	associatedNumberMode: 'linear',
	overflowPolicy: 'reject',
	barcodeMode: 'base_number',
	barcodePattern: null,
	createdBy: null,
	createdAt: '2026-11-18T00:00:00Z',
	updatedAt: '2026-11-18T00:00:00Z'
});

const note: DeliveryNote = {
	id: 'n',
	campaignId: 'c',
	noteNumber: 7,
	collectorId: 'col',
	collectorName: 'Ana Pérez',
	status: 'issued',
	reason: 'delivery',
	issuedAt: '2026-11-18T15:30:00Z',
	createdBy: 'u',
	createdByName: 'Operator One',
	notes: 'Box 3',
	bondCount: 2
};

const simple = (base: number, offset: number, barcode: string | null = null): DeliveryNoteBond => ({
	id: `b${base}`,
	kind: 'simple',
	commercialUnitCount: 1,
	barcode,
	numbers: [
		{ id: `n${base}`, value: base, kind: 'base', sourceBaseNumberId: null, barcode: null },
		{
			id: `a${base}`,
			value: base + offset,
			kind: 'associated',
			sourceBaseNumberId: `n${base}`,
			barcode: null
		}
	],
	members: []
});

describe('buildPrintableDeliveryNote', () => {
	it('fills the 13 fields of docs/documents.md', () => {
		const doc = buildPrintableDeliveryNote(
			campaign(4),
			note,
			[simple(68, 4871, '0068')],
			'Bomberos Test'
		);
		expect(doc).toMatchObject({
			institutionName: 'Bomberos Test',
			campaign: 'Bono 2027',
			deliveryNoteNumber: 'Remito 0007',
			collector: 'Ana Pérez',
			registeredBy: 'Operator One',
			notes: 'Box 3',
			collectorSignature: 'Firma del cobrador',
			administrationSignature: 'Firma de la administración',
			bondCount: 1,
			unitCount: 1
		});
		// SAN-131: shared helper, es-AR with four-digit year and 24 h time (was 12 h "p. m.").
		expect(doc.date).toBe(formatDateTime(note.issuedAt));
		expect(doc.date).toMatch(/^\d{2}\/\d{2}\/\d{4},? \d{2}:\d{2}$/);
		expect(doc.deliveredBonds).toEqual([
			{
				type: 'Simple',
				numbers: [{ base: '0068', associated: '4939', barcode: null }],
				barcode: '0068',
				units: 1
			}
		]);
		expect(doc.baseAndAssociatedNumbers).toEqual(['0068 / 4939']);
		expect(doc.barcode).toEqual(['0068']);
	});

	it('pads with the campaign digits (5 digits)', () => {
		const doc = buildPrintableDeliveryNote(campaign(5), note, [simple(68, 48710)], 'X');
		expect(doc.baseAndAssociatedNumbers).toEqual(['00068 / 48778']);
	});

	it('prints every leg of a printed pata with its row barcode, and the members of a manual pata', () => {
		const printed: DeliveryNoteBond = {
			id: 'p',
			kind: 'pata',
			commercialUnitCount: 2,
			barcode: 'P1',
			numbers: [
				{ id: 'x1', value: 100, kind: 'base', sourceBaseNumberId: null, barcode: 'P1-100' },
				{ id: 'y1', value: 4971, kind: 'associated', sourceBaseNumberId: 'x1', barcode: null },
				{ id: 'x2', value: 101, kind: 'base', sourceBaseNumberId: null, barcode: 'P1-101' },
				{ id: 'y2', value: 4972, kind: 'associated', sourceBaseNumberId: 'x2', barcode: null }
			],
			members: []
		};
		const manual: DeliveryNoteBond = {
			id: 'm',
			kind: 'pata',
			commercialUnitCount: 2,
			barcode: null,
			numbers: [],
			members: [simple(200, 4871), simple(201, 4871)]
		};
		const doc = buildPrintableDeliveryNote(
			campaign(4),
			{ ...note, notes: null },
			[printed, manual],
			'X'
		);
		expect(doc.deliveredBonds.map((b) => [b.type, b.numbers.map((n) => n.base), b.units])).toEqual([
			['Pata', ['0100', '0101'], 2],
			['Pata', ['0200', '0201'], 2]
		]);
		expect(doc.barcode).toEqual(['P1', 'P1-100', 'P1-101']);
		expect(doc).toMatchObject({ bondCount: 2, unitCount: 4, notes: null });
	});

	it('sorts printed bonds and manual pata members by base number', () => {
		const manual: DeliveryNoteBond = {
			id: 'm',
			kind: 'pata',
			commercialUnitCount: 2,
			barcode: null,
			numbers: [],
			members: [simple(201, 4871), simple(200, 4871)]
		};
		const doc = buildPrintableDeliveryNote(campaign(4), note, [simple(68, 4871), manual], 'X');

		expect(doc.deliveredBonds.map((bond) => bond.numbers.map((number) => number.base))).toEqual([
			['0068'],
			['0200', '0201']
		]);
	});
});

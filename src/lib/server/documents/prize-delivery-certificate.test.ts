import { describe, expect, it } from 'vitest';
import type { Campaign } from '$lib/domain/campaigns';
import { buildPrintablePrizeDeliveryCertificate } from './prize-delivery-certificate';
import type { PrizeCertificateSource } from '$lib/server/repositories/printable-prizes';

const campaign = {
	name: 'Campaign <2027>',
	numberDigits: 5,
	maxNumber: 99999,
	associatedNumberOffset: 100,
	overflowPolicy: 'reject'
} as Campaign;
const source = {
	drawName: 'December & summer',
	drawType: 'monthly',
	drawDate: '2026-12-31',
	prizeName: 'Bike <Pro>',
	prizePosition: 2,
	winningNumber: 68,
	bondId: 'bond-id',
	bondLabel: 'B&68',
	buyerSnapshot: { business_name: 'Buyer <SA>' },
	collectorSnapshot: { display_name: 'Collector & Co' },
	rosterEligible: true,
	deliveredAt: '2027-01-01T02:30:00+00:00',
	deliveredByName: 'Operator <One>',
	deliveryNotes: 'Received & signed'
} as unknown as PrizeCertificateSource;

/** ICU emits a regular, no-break or narrow no-break space (U+202F) before `p. m.` depending on version. */
const plainSpaces = (value: string) => value.replace(/\s/gu, ' ');

describe('prize delivery certificate', () => {
	it('builds every field, pads numbers and converts UTC instants to Buenos Aires', () => {
		const doc = buildPrintablePrizeDeliveryCertificate(campaign, source, 'Firefighters');
		expect({ ...doc, deliveryDate: plainSpaces(doc.deliveryDate) }).toEqual({
			institutionName: 'Firefighters',
			draw: 'December & summer (Mensual)',
			drawDate: '31/12/2026',
			prize: '#2 — Bike <Pro>',
			winningNumber: '00068',
			associatedBond: 'B&68',
			buyer: 'Buyer <SA>',
			collector: 'Collector & Co',
			rosterStatus: 'Habilitado',
			deliveryDate: '31/12/2026, 23:30',
			registeredBy: 'Operator <One>',
			notes: 'Received & signed',
			recipientSignature: 'Firma de quien recibe',
			recipientName: 'Aclaración',
			recipientDocument: 'DNI'
		});
	});

	it('never prints the bond UUID when the bond has no label', () => {
		expect(
			buildPrintablePrizeDeliveryCertificate(campaign, { ...source, bondLabel: null })
				.associatedBond
		).toBe('—');
	});

	it('uses frozen person names and safe placeholders for absent optional fields', () => {
		const doc = buildPrintablePrizeDeliveryCertificate(campaign, {
			...source,
			bondLabel: null,
			bondId: null,
			buyerSnapshot: { first_name: 'Ada', last_name: 'Lovelace' },
			collectorSnapshot: null,
			deliveredByName: null,
			deliveryNotes: null
		});
		expect(doc).toMatchObject({
			associatedBond: '—',
			buyer: 'Ada Lovelace',
			collector: '—',
			registeredBy: '—',
			notes: '—'
		});
	});
});

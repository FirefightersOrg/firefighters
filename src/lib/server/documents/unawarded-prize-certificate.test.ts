import { describe, expect, it } from 'vitest';
import type { Campaign } from '$lib/domain/campaigns';
import { buildPrintableUnawardedPrizeCertificate } from './unawarded-prize-certificate';
import type { PrizeCertificateSource } from '$lib/server/repositories/printable-prizes';

const campaign = {
	name: 'Campaign',
	numberDigits: 4,
	maxNumber: 9999,
	associatedNumberOffset: 100,
	associatedNumberMode: 'linear',
	overflowPolicy: 'reject'
} as Campaign;
const source = {
	drawName: 'Final <draw>',
	drawType: 'final',
	prizeName: 'Trip & stay',
	prizePosition: 1,
	winningNumber: 7,
	winnerStatus: 'eligible_winner',
	winnerNotes: 'Original <note>',
	rosterEligible: true,
	buyerSnapshot: { first_name: 'Ada', last_name: 'Lovelace' },
	bondLabel: 'B-7',
	bondId: 'bond',
	unawardedByName: 'Resolver & One',
	unawardedAt: '2027-01-01T02:30:00Z',
	resolutionNotes: 'Winner declined'
} as unknown as PrizeCertificateSource;

/** ICU emits a regular, no-break or narrow no-break space (U+202F) before `p. m.` depending on version. */
const plainSpaces = (value: string) => value.replace(/\s/gu, ' ');

describe('unawarded prize certificate', () => {
	it('builds all fields for a manual unaward and preserves strings for template escaping', () => {
		const doc = buildPrintableUnawardedPrizeCertificate(campaign, source, 'Firefighters');
		expect({ ...doc, date: plainSpaces(doc.date) }).toEqual({
			institutionName: 'Firefighters',
			draw: 'Final <draw> (Final)',
			prize: '#1 — Trip & stay',
			winningNumber: '0007',
			associatedBond: 'B-7',
			buyer: 'Ada Lovelace',
			reason: 'Winner declined',
			rosterStatus: 'Habilitado',
			registeredBy: 'Resolver & One',
			date: '31/12/2026, 23:30',
			notes: 'Original <note>'
		});
	});

	it('labels automatic reasons and absent optional winner data', () => {
		expect(
			buildPrintableUnawardedPrizeCertificate(campaign, {
				...source,
				winningNumber: null,
				winnerStatus: 'no_match',
				rosterEligible: null,
				buyerSnapshot: null,
				bondLabel: null,
				bondId: null,
				winnerNotes: null
			})
		).toMatchObject({
			winningNumber: 'Sin cargar',
			associatedBond: '—',
			buyer: '—',
			reason: 'El número no está en el padrón',
			rosterStatus: 'No está en el padrón'
		});
		expect(
			buildPrintableUnawardedPrizeCertificate(campaign, {
				...source,
				winnerStatus: 'not_eligible',
				rosterEligible: false,
				ineligibilityReason: 'not_fully_paid'
			})
		).toMatchObject({
			reason: 'Bono sin pago total',
			rosterStatus: 'No habilitado — Bono sin pago total'
		});
	});
	it('never prints the bond UUID when the bond has no label', () => {
		expect(
			buildPrintableUnawardedPrizeCertificate(campaign, { ...source, bondLabel: null })
				.associatedBond
		).toBe('—');
	});
});

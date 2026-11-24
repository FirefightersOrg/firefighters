import { describe, expect, it } from 'vitest';
import type { Campaign } from '$lib/domain/campaigns';
import { buildPrintableUnawardedPrizeCertificate } from './unawarded-prize-certificate';
import type { PrizeCertificateSource } from '$lib/server/repositories/printable-prizes';

const campaign = {
	name: 'Campaign',
	numberDigits: 4,
	maxNumber: 9999,
	associatedNumberOffset: 100,
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

describe('unawarded prize certificate', () => {
	it('builds all fields for a manual unaward and preserves strings for template escaping', () => {
		expect(buildPrintableUnawardedPrizeCertificate(campaign, source, 'Firefighters')).toEqual({
			institutionName: 'Firefighters',
			draw: 'Final <draw> (Final)',
			prize: '#1 — Trip & stay',
			winningNumber: '0007',
			associatedBond: 'B-7',
			buyer: 'Ada Lovelace',
			reason: 'Winner declined',
			rosterStatus: 'Eligible',
			registeredBy: 'Resolver & One',
			date: '31/12/26, 11:30 p. m.',
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
			winningNumber: 'Not loaded',
			associatedBond: '—',
			buyer: '—',
			reason: 'Number not in the roster',
			rosterStatus: 'Not in roster'
		});
		expect(
			buildPrintableUnawardedPrizeCertificate(campaign, {
				...source,
				winnerStatus: 'not_eligible',
				rosterEligible: false,
				ineligibilityReason: 'not_fully_paid'
			})
		).toMatchObject({
			reason: 'Bond not fully paid',
			rosterStatus: 'Not eligible — Bond not fully paid'
		});
	});
});

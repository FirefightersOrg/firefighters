import { describe, expect, it } from 'vitest';
import { buyerDisplayName, buyerIdentification, partySearchTerm } from './parties';

describe('parties', () => {
	it('names buyers by type', () => {
		expect(
			buyerDisplayName({
				type: 'business',
				firstName: null,
				lastName: null,
				businessName: 'Sur SRL'
			})
		).toBe('Sur SRL');
		expect(
			buyerDisplayName({
				type: 'individual',
				firstName: 'Juan',
				lastName: 'Gómez',
				businessName: null
			})
		).toBe('Gómez, Juan');
		expect(
			buyerDisplayName({
				type: 'individual',
				firstName: 'Juan',
				lastName: null,
				businessName: null
			})
		).toBe('Juan');
	});

	it('shows the identification that matches the type', () => {
		expect(buyerIdentification({ type: 'business', documentNumber: '1', taxId: '30-1-9' })).toBe(
			'30-1-9'
		);
		expect(buyerIdentification({ type: 'individual', documentNumber: '301', taxId: null })).toBe(
			'301'
		);
		expect(
			buyerIdentification({ type: 'individual', documentNumber: null, taxId: null })
		).toBeNull();
	});

	it('cleans search terms for PostgREST filters', () => {
		expect(partySearchTerm('  Gómez, Juan ')).toBe('Gómez Juan');
		expect(partySearchTerm('a%b_c(d)*e')).toBe('a b c d e');
		expect(partySearchTerm('   ')).toBeNull();
		expect(partySearchTerm(undefined)).toBeNull();
		expect(partySearchTerm('x'.repeat(150))).toHaveLength(100);
	});
});

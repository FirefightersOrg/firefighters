import { describe, expect, it } from 'vitest';
import { PARTY_LIMITS } from '$lib/domain/parties';
import { buyerSchema } from './buyer';

const collectorId = 'c0000000-0000-4000-8000-000000000001';
const individual = {
	type: 'individual',
	firstName: ' Ada ',
	lastName: ' Lovelace ',
	businessName: 'Discard me',
	documentNumber: ' 123 ',
	taxId: 'Discard me',
	phone: '',
	address: '',
	usualCollectorId: collectorId,
	notes: ''
};

describe('buyerSchema', () => {
	it('requires the fields for the selected type and discards fields from the other type', () => {
		expect(buyerSchema.parse(individual)).toMatchObject({
			type: 'individual',
			firstName: 'Ada',
			lastName: 'Lovelace',
			businessName: null,
			documentNumber: '123',
			taxId: null
		});
		expect(
			buyerSchema.parse({
				...individual,
				type: 'business',
				businessName: ' Acme SA ',
				taxId: ' 20-123 ',
				firstName: 'Discard me',
				lastName: 'Discard me',
				documentNumber: 'Discard me'
			})
		).toMatchObject({
			type: 'business',
			businessName: 'Acme SA',
			taxId: '20-123',
			firstName: null,
			lastName: null,
			documentNumber: null
		});
		expect(buyerSchema.safeParse({ ...individual, firstName: '', lastName: '' }).success).toBe(
			false
		);
		expect(
			buyerSchema.safeParse({ ...individual, type: 'business', businessName: '' }).success
		).toBe(false);
	});

	it('enforces party field limits', () => {
		const result = buyerSchema.safeParse({
			...individual,
			firstName: 'x'.repeat(PARTY_LIMITS.firstName + 1),
			phone: 'x'.repeat(PARTY_LIMITS.phone + 1),
			address: 'x'.repeat(PARTY_LIMITS.address + 1),
			notes: 'x'.repeat(PARTY_LIMITS.notes + 1)
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.flatten().fieldErrors).toMatchObject({
				firstName: expect.any(Array),
				phone: expect.any(Array),
				address: expect.any(Array),
				notes: expect.any(Array)
			});
		}
	});
});

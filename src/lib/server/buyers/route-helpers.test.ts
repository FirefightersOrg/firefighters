import { describe, expect, it } from 'vitest';
import { PartyServiceError } from '$lib/server/services/parties';
import { buyerValues, partyFailure, validateBuyer } from './route-helpers';

describe('buyer route helpers', () => {
	it('reads empty usual collector as null and returns highlighted validation errors', () => {
		const form = new FormData();
		for (const [key, value] of Object.entries({
			type: 'individual',
			firstName: '',
			lastName: '',
			businessName: '',
			documentNumber: '',
			taxId: '',
			phone: '',
			address: '',
			usualCollectorId: '',
			notes: ''
		}))
			form.set(key, value);
		const values = buyerValues(form);
		expect(values.usualCollectorId).toBeNull();
		const result = validateBuyer(values);
		expect('failure' in result).toBe(true);
		if ('failure' in result && result.failure) {
			expect(result.failure.data).toMatchObject({
				message: 'Please correct the highlighted fields.',
				errors: { firstName: ['Enter a first or last name.'] }
			});
		}
	});

	it('keeps field service errors associated with their input and a general message', () => {
		const result = partyFailure(
			new PartyServiceError('validation', 'A document number is invalid.', {
				field: 'documentNumber'
			}),
			{}
		);
		expect(result.data).toMatchObject({
			message: 'Please correct the highlighted fields.',
			errors: { documentNumber: ['A document number is invalid.'] }
		});
	});
});

import { z } from 'zod';
import { BUYER_TYPES, PARTY_LIMITS } from '$lib/domain/parties';

const text = (max: number) =>
	z
		.string()
		.trim()
		.max(max)
		.optional()
		.transform((v) => v || null);

export const BUYER_FORM_FIELDS = [
	'type',
	'firstName',
	'lastName',
	'businessName',
	'documentNumber',
	'taxId',
	'phone',
	'address',
	'usualCollectorId',
	'notes'
] as const;

export const buyerSchema = z
	.object({
		type: z.enum(BUYER_TYPES),
		firstName: text(PARTY_LIMITS.firstName),
		lastName: text(PARTY_LIMITS.lastName),
		businessName: text(PARTY_LIMITS.businessName),
		documentNumber: text(PARTY_LIMITS.documentNumber),
		taxId: text(PARTY_LIMITS.taxId),
		phone: text(PARTY_LIMITS.phone),
		address: text(PARTY_LIMITS.address),
		usualCollectorId: z.string().uuid().nullable(),
		notes: text(PARTY_LIMITS.notes)
	})
	.superRefine((data, ctx) => {
		if (data.type === 'individual' && !data.firstName && !data.lastName)
			ctx.addIssue({ code: 'custom', path: ['firstName'], message: 'Enter a first or last name.' });
		if (data.type === 'business' && !data.businessName)
			ctx.addIssue({ code: 'custom', path: ['businessName'], message: 'Enter a business name.' });
	})
	.transform((data) =>
		data.type === 'individual'
			? { ...data, businessName: null, taxId: null }
			: { ...data, firstName: null, lastName: null, documentNumber: null }
	);

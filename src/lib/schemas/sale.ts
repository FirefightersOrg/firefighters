import { z } from 'zod';

export const saleRegisterSchema = z.object({
	campaignId: z.guid({ message: 'Unknown campaign' }),
	bondId: z.guid({ message: 'Unknown bond' }),
	buyerId: z.guid({ message: 'Elegir un comprador.' }),
	paymentMode: z.enum(['full_payment', 'installments']),
	firstDueDate: z.iso.date().nullable().optional(),
	/** SAN-106: an earlier sale date (YYYY-MM-DD, Buenos Aires); null or absent means today. */
	saleDate: z.iso.date().nullable().optional()
});

export type SaleRegisterInput = z.output<typeof saleRegisterSchema>;

import { z } from 'zod';
import { COLLECTOR_STATUSES, PARTY_LIMITS } from '$lib/domain/parties';

export const COLLECTOR_FORM_FIELDS = [
	'displayName',
	'phone',
	'email',
	'address',
	'status',
	'userProfileId'
] as const;
export const COLLECTOR_UPDATE_FIELDS = [...COLLECTOR_FORM_FIELDS, 'updatedAt'] as const;

const nullableText = (max: number) =>
	z
		.string()
		.max(max, `Debe tener como máximo ${max} caracteres.`)
		.transform((value) => value.trim() || null);

export const collectorSchema = z.object({
	displayName: z
		.string()
		.trim()
		.min(1, 'Ingresar el nombre del cobrador.')
		.max(
			PARTY_LIMITS.displayName,
			`Debe tener como máximo ${PARTY_LIMITS.displayName} caracteres.`
		),
	phone: nullableText(PARTY_LIMITS.phone),
	email: nullableText(PARTY_LIMITS.email).pipe(
		z.string().email('Ingresar un correo electrónico válido.').nullable()
	),
	address: nullableText(PARTY_LIMITS.address),
	status: z.enum(COLLECTOR_STATUSES),
	userProfileId: z
		.string()
		.trim()
		.transform((value) => value || null)
		.pipe(z.string().uuid('Elegir un usuario válido.').nullable())
});

export type CollectorFormValues = Record<(typeof COLLECTOR_FORM_FIELDS)[number], string>;

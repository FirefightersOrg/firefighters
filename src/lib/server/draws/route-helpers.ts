import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { DRAW_NAME_MAX, type DrawType } from '$lib/domain/draws';

export const uuid = z.guid();
export const field = (form: FormData, name: string) => String(form.get(name) ?? '').trim();
const codePoints = (max: number) =>
	z
		.string()
		.trim()
		.min(1, 'This field is required.')
		.refine((value) => [...value].length <= max, {
			message: `Use at most ${max} characters.`
		});

/** datetime-local is a wall clock in Buenos Aires; Argentina currently uses UTC-03 year-round. */
export function buenosAiresTimestamp(local: string): string | null {
	if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(local)) return null;
	const value = `${local.length === 16 ? `${local}:00` : local}-03:00`;
	return Number.isNaN(Date.parse(value)) ? null : value;
}

export const drawFieldsSchema = z
	.object({
		name: codePoints(DRAW_NAME_MAX),
		drawDate: z.string().date(),
		paymentCutoffLocal: z.string().min(1),
		requiredInstallmentNumber: z.string(),
		consolationRequiredInstallmentNumber: z.string()
	})
	.transform((value, ctx) => {
		const paymentCutoffAt = buenosAiresTimestamp(value.paymentCutoffLocal);
		if (!paymentCutoffAt) {
			ctx.addIssue({
				code: 'custom',
				path: ['paymentCutoffLocal'],
				message: 'Ingresar una fecha y hora de corte válidas.'
			});
			return z.NEVER;
		}
		const required = value.requiredInstallmentNumber
			? Number(value.requiredInstallmentNumber)
			: null;
		const consolation = value.consolationRequiredInstallmentNumber
			? Number(value.consolationRequiredInstallmentNumber)
			: null;
		if (
			(required !== null && (!Number.isInteger(required) || required < 1)) ||
			(consolation !== null && (!Number.isInteger(consolation) || consolation < 1))
		) {
			ctx.addIssue({
				code: 'custom',
				path: ['requiredInstallmentNumber'],
				message: 'Elegir una cuota válida.'
			});
			return z.NEVER;
		}
		return { ...value, paymentCutoffAt, requiredInstallmentNumber: required, consolation };
	});

export function readDrawFields(form: FormData) {
	const cutoff =
		field(form, 'paymentCutoffLocal') ||
		[field(form, 'paymentCutoffDate'), field(form, 'paymentCutoffTime')].filter(Boolean).join('T');
	return {
		name: field(form, 'name'),
		drawDate: field(form, 'drawDate'),
		paymentCutoffLocal: cutoff,
		requiredInstallmentNumber: field(form, 'requiredInstallmentNumber'),
		consolationRequiredInstallmentNumber: field(form, 'consolationRequiredInstallmentNumber')
	};
}
export function validateDrawFields(
	values: ReturnType<typeof readDrawFields>,
	type: DrawType,
	installmentCount: number
) {
	const parsed = drawFieldsSchema.safeParse(values);
	if (!parsed.success)
		return {
			failure: fail(400, {
				form: 'draw',
				values,
				errors: parsed.error.flatten().fieldErrors,
				message: 'Revisar los campos marcados.'
			})
		};
	if (type === 'monthly' && parsed.data.requiredInstallmentNumber === null)
		return {
			failure: fail(400, {
				form: 'draw',
				values,
				errors: { requiredInstallmentNumber: ['Los sorteos mensuales requieren una cuota.'] },
				message: 'Revisar los campos marcados.'
			})
		};
	if (
		(parsed.data.requiredInstallmentNumber ?? 0) > installmentCount ||
		(parsed.data.consolation ?? 0) > installmentCount
	)
		return {
			failure: fail(400, {
				form: 'draw',
				values,
				errors: { requiredInstallmentNumber: ['La cuota supera el plan de la campaña.'] },
				message: 'Revisar los campos marcados.'
			})
		};
	return {
		data: {
			name: parsed.data.name,
			drawDate: parsed.data.drawDate,
			paymentCutoffAt: parsed.data.paymentCutoffAt,
			requiredInstallmentNumber: parsed.data.requiredInstallmentNumber,
			eligibilityRule:
				type === 'consolation' && parsed.data.consolation !== null
					? { consolation_rule: { required_installment_number: parsed.data.consolation } }
					: {}
		}
	};
}

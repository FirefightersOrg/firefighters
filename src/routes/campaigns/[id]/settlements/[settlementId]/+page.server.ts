import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { z } from 'zod';
import {
	hasPermissionIn,
	permissionsUnavailable,
	requirePermissionIn
} from '$lib/server/auth/permissions';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import {
	getSettlement,
	getSettlementTotals,
	listCollectorPaymentCandidates,
	listSettlementPayments
} from '$lib/server/repositories/settlements';
import {
	addPaymentToSettlement,
	closeSettlement,
	removePaymentFromSettlement,
	SettlementServiceError
} from '$lib/server/services/settlements';
import {
	annulPayment,
	correctPaymentMethod,
	reassociateTransfer
} from '$lib/server/services/payment-corrections';
import { correctSettlement } from '$lib/server/services/sale-corrections';
import { PAYMENT_ANNULMENT_REASON_MAX } from '$lib/domain/payments';
import { centsToDecimalString, parseMoneyInput, parseMoneyToCents } from '$lib/domain/money';
import type { PermissionCode } from '$lib/server/auth/permission-codes';
const uuid = z.guid();
const field = (f: FormData, n: string) => String(f.get(n) ?? '').trim();
const denied = (locals: App.Locals, permission: PermissionCode) =>
	!hasPermissionIn(locals.permissions, permission);
export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (permissionsUnavailable(locals.permissions))
		error(500, { message: 'No se pudieron cargar los permisos.' });
	requireCampaignViewer(locals, url);
	if (
		!(
			[
				'settlement.view',
				'settlement.create',
				'settlement.update_open',
				'settlement.close',
				'settlement.correct'
			] as PermissionCode[]
		).some((p) => hasPermissionIn(locals.permissions, p))
	)
		requirePermissionIn(locals.permissions, 'settlement.view');
	if (!uuid.safeParse(params.settlementId).success)
		error(404, { message: 'Rendición no encontrada.' });
	const [campaign, settlement] = await Promise.all([
		getCampaignById(locals.supabase, params.id),
		getSettlement(locals.supabase, params.id, params.settlementId)
	]);
	if (campaign.error || settlement.error)
		error(500, { message: 'No se pudo cargar la rendición.' });
	if (!campaign.data) error(404, { message: 'Campaña no encontrada.' });
	if (!settlement.data) error(404, { message: 'Rendición no encontrada.' });
	const open = settlement.data.status === 'open';
	const canCorrectPayment = hasPermissionIn(locals.permissions, 'payment.annul');
	const canCorrectSettlement =
		settlement.data.status === 'closed' &&
		hasPermissionIn(locals.permissions, 'settlement.correct');
	const [totals, payments, candidates] = await Promise.all([
		getSettlementTotals(locals.supabase, params.settlementId),
		listSettlementPayments(locals.supabase, params.settlementId),
		open || canCorrectPayment
			? listCollectorPaymentCandidates(locals.supabase, params.id, settlement.data.collectorId)
			: Promise.resolve({ data: [], error: null })
	]);
	if (totals.error || payments.error || candidates.error)
		error(500, { message: 'No se pudo cargar la rendición.' });
	return {
		campaign: campaign.data,
		settlement: settlement.data,
		totals: open
			? totals.data
			: {
					...settlement.data.totals,
					collectorCreditBalance:
						totals.data?.collectorCreditBalance ?? settlement.data.totals.collectorCreditBalance
				},
		payments: payments.data ?? [],
		candidates: candidates.data ?? [],
		reasonMax: PAYMENT_ANNULMENT_REASON_MAX,
		can: {
			add:
				open &&
				hasPermissionIn(locals.permissions, 'settlement.update_open') &&
				hasPermissionIn(locals.permissions, 'payment.create'),
			remove: open && hasPermissionIn(locals.permissions, 'settlement.update_open'),
			close: open && hasPermissionIn(locals.permissions, 'settlement.close'),
			correctPayment: canCorrectPayment,
			correctSettlement: canCorrectSettlement
		}
	};
};
function serviceFailure(err: unknown, form: string, values: Record<string, string> = {}) {
	const e = err instanceof SettlementServiceError ? err : null;
	return fail(e?.status ?? 500, {
		form,
		values,
		errors: {},
		message: e?.message ?? 'Something went wrong. Please try again.'
	});
}
async function settlementForPaymentCorrection(
	locals: App.Locals,
	params: { id: string; settlementId: string },
	form: string,
	values: Record<string, string>
) {
	if (!uuid.safeParse(params.id).success || !uuid.safeParse(params.settlementId).success)
		return fail(404, { form, values, errors: {}, message: 'Rendición no encontrada.' });
	const settlement = await getSettlement(locals.supabase, params.id, params.settlementId);
	if (settlement.error) return serviceFailure(settlement.error, form, values);
	if (!settlement.data)
		return fail(404, { form, values, errors: {}, message: 'Rendición no encontrada.' });
	return null;
}
export const actions: Actions = {
	add: async ({ request, locals, params, url }) => {
		if (permissionsUnavailable(locals.permissions))
			return fail(500, { form: 'add', errors: {}, message: 'No se pudieron cargar los permisos.' });
		requireCampaignViewer(locals, url);
		if (denied(locals, 'settlement.update_open') || denied(locals, 'payment.create'))
			return fail(403, {
				form: 'add',
				errors: {},
				message: 'No tenés permiso para hacer esta acción.'
			});
		const f = await request.formData();
		const saleId = field(f, 'saleId');
		const ids = f.getAll('installmentId').filter((v): v is string => typeof v === 'string');
		const applications = ids.map((id) => ({
			installmentId: id,
			amountApplied: field(f, `amount-${id}`)
		}));
		const method = field(f, 'paymentMethod');
		if (!uuid.safeParse(saleId).success || !ids.length || !['cash', 'transfer'].includes(method))
			return fail(400, {
				form: 'add',
				errors: { installmentId: ['Elegir una o más cuotas.'] },
				message: 'Revisar los campos marcados.'
			});
		const settlement = await getSettlement(locals.supabase, params.id, params.settlementId);
		if (settlement.error) return serviceFailure(settlement.error, 'add');
		if (!settlement.data || settlement.data.status !== 'open')
			return fail(400, {
				form: 'add',
				errors: {},
				message: 'Esta rendición ya no está abierta.'
			});
		const candidates = await listCollectorPaymentCandidates(
			locals.supabase,
			params.id,
			settlement.data.collectorId
		);
		if (candidates.error) return serviceFailure(candidates.error, 'add');
		const available = new Map(
			(candidates.data ?? [])
				.filter((candidate) => candidate.saleId === saleId)
				.map((candidate) => [candidate.id, parseMoneyToCents(candidate.amount)])
		);
		let totalCents = 0;
		const validationErrors: Record<string, string[]> = {};
		for (const application of applications) {
			const cents = parseMoneyInput(application.amountApplied);
			const remaining = available.get(application.installmentId);
			if (cents === null || cents <= 0)
				validationErrors[`amount-${application.installmentId}`] = [
					'Enter an amount greater than zero.'
				];
			else if (remaining !== undefined && remaining !== null && cents > remaining)
				validationErrors[`amount-${application.installmentId}`] = [
					'The amount cannot exceed the installment balance.'
				];
			else if (remaining === undefined)
				validationErrors.installmentId = ['Elegir cuotas válidas de la venta elegida.'];
			else totalCents += cents;
		}
		if (new Set(ids).size !== ids.length)
			validationErrors.installmentId = ['Elegir cada cuota una sola vez.'];
		if (Object.keys(validationErrors).length)
			return fail(400, {
				form: 'add',
				errors: validationErrors,
				message: 'Revisar los campos marcados.'
			});
		const amount = centsToDecimalString(totalCents);
		try {
			await addPaymentToSettlement(
				locals.supabase,
				{
					settlementId: params.settlementId,
					saleId,
					amount,
					paymentMethod: method as 'cash' | 'transfer',
					applications
				},
				{ requestId: locals.requestId, permissions: locals.permissions ?? null }
			);
			return { form: 'add', success: true, message: 'Pago agregado.', errors: {} };
		} catch (e) {
			return serviceFailure(e, 'add');
		}
	},
	annulPayment: async ({ request, locals, params, url }) => {
		if (permissionsUnavailable(locals.permissions))
			return fail(500, {
				form: 'annulPayment',
				errors: {},
				message: 'No se pudieron cargar los permisos.'
			});
		requireCampaignViewer(locals, url);
		if (denied(locals, 'payment.annul'))
			return fail(403, {
				form: 'annulPayment',
				errors: {},
				message: 'No tenés permiso para hacer esta acción.'
			});
		const f = await request.formData();
		const values = { paymentId: field(f, 'paymentId'), reason: field(f, 'reason') };
		const missingSettlement = await settlementForPaymentCorrection(
			locals,
			params,
			'annulPayment',
			values
		);
		if (missingSettlement) return missingSettlement;
		try {
			await annulPayment(locals.supabase, values, {
				requestId: locals.requestId ?? null,
				permissions: locals.permissions ?? null
			});
			return { form: 'annulPayment', success: true, message: 'Pago anulado.', errors: {} };
		} catch (e) {
			return serviceFailure(e, 'annulPayment', values);
		}
	},
	correctPaymentMethod: async ({ request, locals, params, url }) => {
		if (permissionsUnavailable(locals.permissions))
			return fail(500, {
				form: 'correctPaymentMethod',
				errors: {},
				message: 'No se pudieron cargar los permisos.'
			});
		requireCampaignViewer(locals, url);
		if (denied(locals, 'payment.annul'))
			return fail(403, {
				form: 'correctPaymentMethod',
				errors: {},
				message: 'No tenés permiso para hacer esta acción.'
			});
		const f = await request.formData();
		const values = {
			paymentId: field(f, 'paymentId'),
			newMethod: field(f, 'newMethod'),
			reason: field(f, 'reason')
		};
		const missingSettlement = await settlementForPaymentCorrection(
			locals,
			params,
			'correctPaymentMethod',
			values
		);
		if (missingSettlement) return missingSettlement;
		try {
			await correctPaymentMethod(
				locals.supabase,
				values as Parameters<typeof correctPaymentMethod>[1],
				{ requestId: locals.requestId ?? null, permissions: locals.permissions ?? null }
			);
			return {
				form: 'correctPaymentMethod',
				success: true,
				message: 'Método de pago corregido.',
				errors: {}
			};
		} catch (e) {
			return serviceFailure(e, 'correctPaymentMethod', values);
		}
	},
	reassociateTransfer: async ({ request, locals, params, url }) => {
		if (permissionsUnavailable(locals.permissions))
			return fail(500, {
				form: 'reassociateTransfer',
				errors: {},
				message: 'No se pudieron cargar los permisos.'
			});
		requireCampaignViewer(locals, url);
		if (denied(locals, 'payment.annul'))
			return fail(403, {
				form: 'reassociateTransfer',
				errors: {},
				message: 'No tenés permiso para hacer esta acción.'
			});
		const f = await request.formData();
		const values = {
			paymentId: field(f, 'paymentId'),
			newSaleId: field(f, 'newSaleId'),
			installmentId: field(f, 'installmentId'),
			amountApplied: field(f, 'amountApplied'),
			reason: field(f, 'reason')
		};
		const missingSettlement = await settlementForPaymentCorrection(
			locals,
			params,
			'reassociateTransfer',
			values
		);
		if (missingSettlement) return missingSettlement;
		try {
			await reassociateTransfer(
				locals.supabase,
				{
					paymentId: values.paymentId,
					newSaleId: values.newSaleId,
					applications: [
						{ installmentId: values.installmentId, amountApplied: values.amountApplied }
					],
					reason: values.reason
				},
				{ requestId: locals.requestId ?? null, permissions: locals.permissions ?? null }
			);
			return {
				form: 'reassociateTransfer',
				success: true,
				message: 'Transferencia reasociada.',
				errors: {}
			};
		} catch (e) {
			return serviceFailure(e, 'reassociateTransfer', values);
		}
	},
	correctSettlement: async ({ request, locals, params, url }) => {
		if (permissionsUnavailable(locals.permissions))
			return fail(500, {
				form: 'correctSettlement',
				errors: {},
				message: 'No se pudieron cargar los permisos.'
			});
		requireCampaignViewer(locals, url);
		if (denied(locals, 'settlement.correct'))
			return fail(403, {
				form: 'correctSettlement',
				errors: {},
				message: 'No tenés permiso para hacer esta acción.'
			});
		const f = await request.formData();
		const values = {
			commissionDelta: field(f, 'commissionDelta'),
			cashRetainedDelta: field(f, 'cashRetainedDelta'),
			reason: field(f, 'reason')
		};
		try {
			await correctSettlement(
				locals.supabase,
				{
					settlementId: params.settlementId,
					reason: values.reason,
					adjustments: {
						commissionDelta: values.commissionDelta,
						cashRetainedDelta: values.cashRetainedDelta
					}
				},
				{ requestId: locals.requestId ?? null, permissions: locals.permissions ?? null }
			);
			return {
				form: 'correctSettlement',
				success: true,
				message: 'Corrección de la rendición registrada.',
				errors: {}
			};
		} catch (e) {
			return serviceFailure(e, 'correctSettlement', values);
		}
	},
	remove: async ({ request, locals, url }) => {
		if (permissionsUnavailable(locals.permissions))
			return fail(500, {
				form: 'remove',
				errors: {},
				message: 'No se pudieron cargar los permisos.'
			});
		requireCampaignViewer(locals, url);
		if (denied(locals, 'settlement.update_open'))
			return fail(403, {
				form: 'remove',
				errors: {},
				message: 'No tenés permiso para hacer esta acción.'
			});
		const f = await request.formData();
		const paymentId = field(f, 'paymentId'),
			reason = field(f, 'reason');
		if (
			!uuid.safeParse(paymentId).success ||
			!reason ||
			[...reason].length > PAYMENT_ANNULMENT_REASON_MAX
		)
			return fail(400, {
				form: 'remove',
				errors: { reason: ['Ingresar un motivo de anulación dentro del largo máximo.'] },
				message: 'Revisar los campos marcados.'
			});
		try {
			await removePaymentFromSettlement(
				locals.supabase,
				{ paymentId, reason },
				{ requestId: locals.requestId, permissions: locals.permissions ?? null }
			);
			return { form: 'remove', success: true, message: 'Pago quitado.', errors: {} };
		} catch (e) {
			return serviceFailure(e, 'remove');
		}
	},
	close: async ({ locals, params, url }) => {
		if (permissionsUnavailable(locals.permissions))
			return fail(500, {
				form: 'close',
				errors: {},
				message: 'No se pudieron cargar los permisos.'
			});
		requireCampaignViewer(locals, url);
		if (denied(locals, 'settlement.close'))
			return fail(403, {
				form: 'close',
				errors: {},
				message: 'No tenés permiso para hacer esta acción.'
			});
		try {
			await closeSettlement(
				locals.supabase,
				{ settlementId: params.settlementId },
				{ requestId: locals.requestId, permissions: locals.permissions ?? null }
			);
			return { form: 'close', success: true, message: 'Rendición cerrada.', errors: {} };
		} catch (e) {
			return serviceFailure(e, 'close');
		}
	}
};

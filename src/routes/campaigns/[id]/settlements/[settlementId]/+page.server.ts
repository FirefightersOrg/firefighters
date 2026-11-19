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
import { PAYMENT_ANNULMENT_REASON_MAX } from '$lib/domain/payments';
import { centsToDecimalString, parseMoneyInput, parseMoneyToCents } from '$lib/domain/money';
import type { PermissionCode } from '$lib/server/auth/permission-codes';
const uuid = z.guid();
const field = (f: FormData, n: string) => String(f.get(n) ?? '').trim();
const denied = (locals: App.Locals, permission: PermissionCode) =>
	!hasPermissionIn(locals.permissions, permission);
export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (permissionsUnavailable(locals.permissions))
		error(500, { message: 'Could not load permissions.' });
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
		error(404, { message: 'Settlement not found.' });
	const [campaign, settlement] = await Promise.all([
		getCampaignById(locals.supabase, params.id),
		getSettlement(locals.supabase, params.id, params.settlementId)
	]);
	if (campaign.error || settlement.error) error(500, { message: 'Could not load settlement.' });
	if (!campaign.data) error(404, { message: 'Campaign not found.' });
	if (!settlement.data) error(404, { message: 'Settlement not found.' });
	const open = settlement.data.status === 'open';
	const [totals, payments, candidates] = await Promise.all([
		open
			? getSettlementTotals(locals.supabase, params.settlementId)
			: Promise.resolve({ data: settlement.data.totals, error: null }),
		listSettlementPayments(locals.supabase, params.settlementId),
		open
			? listCollectorPaymentCandidates(locals.supabase, params.id, settlement.data.collectorId)
			: Promise.resolve({ data: [], error: null })
	]);
	if (totals.error || payments.error || candidates.error)
		error(500, { message: 'Could not load settlement.' });
	return {
		campaign: campaign.data,
		settlement: settlement.data,
		totals: totals.data,
		payments: payments.data ?? [],
		candidates: candidates.data ?? [],
		reasonMax: PAYMENT_ANNULMENT_REASON_MAX,
		can: {
			add:
				open &&
				hasPermissionIn(locals.permissions, 'settlement.update_open') &&
				hasPermissionIn(locals.permissions, 'payment.create'),
			remove: open && hasPermissionIn(locals.permissions, 'settlement.update_open'),
			close: open && hasPermissionIn(locals.permissions, 'settlement.close')
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
export const actions: Actions = {
	add: async ({ request, locals, params, url }) => {
		if (permissionsUnavailable(locals.permissions))
			return fail(500, { form: 'add', errors: {}, message: 'Could not load permissions.' });
		requireCampaignViewer(locals, url);
		if (denied(locals, 'settlement.update_open') || denied(locals, 'payment.create'))
			return fail(403, {
				form: 'add',
				errors: {},
				message: 'You do not have permission to perform this action.'
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
				errors: { installmentId: ['Select one or more installments.'] },
				message: 'Please correct the highlighted fields.'
			});
		const settlement = await getSettlement(locals.supabase, params.id, params.settlementId);
		if (settlement.error) return serviceFailure(settlement.error, 'add');
		if (!settlement.data || settlement.data.status !== 'open')
			return fail(400, {
				form: 'add',
				errors: {},
				message: 'This settlement is no longer open.'
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
				validationErrors.installmentId = ['Select valid installments for the selected sale.'];
			else totalCents += cents;
		}
		if (new Set(ids).size !== ids.length)
			validationErrors.installmentId = ['Select each installment only once.'];
		if (Object.keys(validationErrors).length)
			return fail(400, {
				form: 'add',
				errors: validationErrors,
				message: 'Please correct the highlighted fields.'
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
			return { form: 'add', success: true, message: 'Payment added.', errors: {} };
		} catch (e) {
			return serviceFailure(e, 'add');
		}
	},
	remove: async ({ request, locals, url }) => {
		if (permissionsUnavailable(locals.permissions))
			return fail(500, { form: 'remove', errors: {}, message: 'Could not load permissions.' });
		requireCampaignViewer(locals, url);
		if (denied(locals, 'settlement.update_open'))
			return fail(403, {
				form: 'remove',
				errors: {},
				message: 'You do not have permission to perform this action.'
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
				errors: { reason: ['Enter an annulment reason within the maximum length.'] },
				message: 'Please correct the highlighted fields.'
			});
		try {
			await removePaymentFromSettlement(
				locals.supabase,
				{ paymentId, reason },
				{ requestId: locals.requestId, permissions: locals.permissions ?? null }
			);
			return { form: 'remove', success: true, message: 'Payment removed.', errors: {} };
		} catch (e) {
			return serviceFailure(e, 'remove');
		}
	},
	close: async ({ locals, params, url }) => {
		if (permissionsUnavailable(locals.permissions))
			return fail(500, { form: 'close', errors: {}, message: 'Could not load permissions.' });
		requireCampaignViewer(locals, url);
		if (denied(locals, 'settlement.close'))
			return fail(403, {
				form: 'close',
				errors: {},
				message: 'You do not have permission to perform this action.'
			});
		try {
			await closeSettlement(
				locals.supabase,
				{ settlementId: params.settlementId },
				{ requestId: locals.requestId, permissions: locals.permissions ?? null }
			);
			return { form: 'close', success: true, message: 'Settlement closed.', errors: {} };
		} catch (e) {
			return serviceFailure(e, 'close');
		}
	}
};

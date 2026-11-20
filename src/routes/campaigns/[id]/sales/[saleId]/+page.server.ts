import { error, fail } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import {
	hasPermissionIn,
	permissionsUnavailable,
	requirePermissionIn
} from '$lib/server/auth/permissions';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { getSaleDetail } from '$lib/server/repositories/sales';
import { calculateFinancialStatus } from '$lib/domain/financial-status';
import { listActiveCollectorOptions, listBuyers } from '$lib/server/repositories/parties';
import {
	correctSaleBuyer,
	correctSaleCollector,
	SaleCorrectionServiceError
} from '$lib/server/services/sale-corrections';

const field = (form: FormData, name: string) => String(form.get(name) ?? '').trim();
const correctionFailure = (cause: unknown, form: string, values: Record<string, string>) => {
	const service = cause instanceof SaleCorrectionServiceError ? cause : null;
	return fail(service?.status ?? 500, {
		form,
		values,
		errors: {},
		message: service?.message ?? 'Could not record correction.'
	});
};
async function saleForAction(
	locals: App.Locals,
	params: { id: string; saleId: string },
	form: string,
	values: Record<string, string>
) {
	if (!z.guid().safeParse(params.id).success || !z.guid().safeParse(params.saleId).success)
		return fail(404, { form, values, errors: {}, message: 'Sale not found.' });
	const sale = await getSaleDetail(locals.supabase, params.id, params.saleId);
	if (sale.error) return correctionFailure(sale.error, form, values);
	if (!sale.data) return fail(404, { form, values, errors: {}, message: 'Sale not found.' });
	return null;
}

export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (permissionsUnavailable(locals.permissions))
		error(500, { message: 'Could not load permissions.' });
	requireCampaignViewer(locals, url);
	if (
		!hasPermissionIn(locals.permissions, 'sale.view') &&
		!hasPermissionIn(locals.permissions, 'sale.create')
	)
		requirePermissionIn(locals.permissions, 'bond.view');
	if (!z.guid().safeParse(params.id).success || !z.guid().safeParse(params.saleId).success)
		error(404, { message: 'Sale not found.' });
	const canCorrect = hasPermissionIn(locals.permissions, 'sale.correct');
	const [campaign, sale, buyers, collectors] = await Promise.all([
		getCampaignById(locals.supabase, params.id),
		getSaleDetail(locals.supabase, params.id, params.saleId),
		canCorrect
			? listBuyers(locals.supabase, { pageSize: 500 })
			: Promise.resolve({ data: null, error: null }),
		canCorrect
			? listActiveCollectorOptions(locals.supabase)
			: Promise.resolve({ data: [], error: null })
	]);
	if (campaign.error || sale.error || buyers.error || collectors.error)
		error(500, { message: 'Could not load sale.' });
	if (!campaign.data) error(404, { message: 'Campaign not found.' });
	if (!sale.data) error(404, { message: 'Sale not found.' });
	const today = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'America/Argentina/Buenos_Aires'
	}).format(new Date());
	return {
		campaign: campaign.data,
		sale: sale.data,
		correction: canCorrect
			? {
					buyers: buyers.data?.items ?? [],
					collectors: collectors.data ?? []
				}
			: null,
		financialStatusSnapshot: sale.data.financialStatus,
		financialStatus: calculateFinancialStatus({
			saleStatus: sale.data.sale.status,
			planStatus: sale.data.plan.status,
			markedUncollectible: false,
			today,
			installments: sale.data.installments.map((item) => ({
				...item,
				number: item.installmentNumber,
				// TODO(Phase 8, payments): use actual applied amounts after payment allocation is implemented.
				appliedAmount: '0.00'
			}))
		})
	};
};

export const actions: Actions = {
	correctBuyer: async ({ request, locals, params, url }) => {
		if (permissionsUnavailable(locals.permissions))
			return fail(500, {
				form: 'correctBuyer',
				errors: {},
				message: 'Could not load permissions.'
			});
		requireCampaignViewer(locals, url);
		if (!hasPermissionIn(locals.permissions, 'sale.correct'))
			return fail(403, {
				form: 'correctBuyer',
				errors: {},
				message: 'You do not have permission to perform this action.'
			});
		const data = await request.formData();
		const values = { newBuyerId: field(data, 'newBuyerId'), reason: field(data, 'reason') };
		const missingSale = await saleForAction(locals, params, 'correctBuyer', values);
		if (missingSale) return missingSale;
		try {
			await correctSaleBuyer(
				locals.supabase,
				{ saleId: params.saleId, ...values },
				{ requestId: locals.requestId ?? null, permissions: locals.permissions ?? null }
			);
			return { form: 'correctBuyer', success: true, message: 'Buyer corrected.', errors: {} };
		} catch (cause) {
			return correctionFailure(cause, 'correctBuyer', values);
		}
	},
	correctCollector: async ({ request, locals, params, url }) => {
		if (permissionsUnavailable(locals.permissions))
			return fail(500, {
				form: 'correctCollector',
				errors: {},
				message: 'Could not load permissions.'
			});
		requireCampaignViewer(locals, url);
		if (!hasPermissionIn(locals.permissions, 'sale.correct'))
			return fail(403, {
				form: 'correctCollector',
				errors: {},
				message: 'You do not have permission to perform this action.'
			});
		const data = await request.formData();
		const values = { newCollectorId: field(data, 'newCollectorId'), reason: field(data, 'reason') };
		const missingSale = await saleForAction(locals, params, 'correctCollector', values);
		if (missingSale) return missingSale;
		try {
			await correctSaleCollector(
				locals.supabase,
				{ saleId: params.saleId, ...values },
				{ requestId: locals.requestId ?? null, permissions: locals.permissions ?? null }
			);
			return {
				form: 'correctCollector',
				success: true,
				message: 'Collector corrected.',
				errors: {}
			};
		} catch (cause) {
			return correctionFailure(cause, 'correctCollector', values);
		}
	}
};

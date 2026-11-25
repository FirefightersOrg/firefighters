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
import { markSaleUncollectible } from '$lib/server/services/sale-uncollectible';
import { SaleServiceError } from '$lib/server/services/sales';

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
		return fail(404, { form, values, errors: {}, message: 'Venta no encontrada.' });
	const sale = await getSaleDetail(locals.supabase, params.id, params.saleId);
	if (sale.error) return correctionFailure(sale.error, form, values);
	if (!sale.data) return fail(404, { form, values, errors: {}, message: 'Venta no encontrada.' });
	return null;
}

export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (permissionsUnavailable(locals.permissions))
		error(500, { message: 'No se pudieron cargar los permisos.' });
	requireCampaignViewer(locals, url);
	if (
		!hasPermissionIn(locals.permissions, 'sale.view') &&
		!hasPermissionIn(locals.permissions, 'sale.create')
	)
		requirePermissionIn(locals.permissions, 'bond.view');
	if (!z.guid().safeParse(params.id).success || !z.guid().safeParse(params.saleId).success)
		error(404, { message: 'Venta no encontrada.' });
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
		error(500, { message: 'No se pudo cargar la venta.' });
	if (!campaign.data) error(404, { message: 'Campaña no encontrada.' });
	if (!sale.data) error(404, { message: 'Venta no encontrada.' });
	const today = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'America/Argentina/Buenos_Aires'
	}).format(new Date());
	return {
		campaign: campaign.data,
		sale: sale.data,
		/** SAN-106: admin or treasurer, on an active sale that is not marked yet. */
		canMarkUncollectible:
			hasPermissionIn(locals.permissions, 'sale.mark_uncollectible') &&
			sale.data.sale.status === 'active' &&
			sale.data.uncollectible === null,
		correction: canCorrect
			? {
					buyers: buyers.data?.items ?? [],
					/** More buyers exist than the selector shows (it lists the first 500). */
					buyersTotal: buyers.data?.total ?? 0,
					collectors: collectors.data ?? []
				}
			: null,
		financialStatusSnapshot: sale.data.financialStatus,
		financialStatus: calculateFinancialStatus({
			saleStatus: sale.data.sale.status,
			planStatus: sale.data.plan.status,
			markedUncollectible: sale.data.uncollectible !== null,
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
	markUncollectible: async ({ request, locals, params, url }) => {
		const form = 'markUncollectible';
		if (permissionsUnavailable(locals.permissions))
			return fail(500, { form, errors: {}, message: 'No se pudieron cargar los permisos.' });
		requireCampaignViewer(locals, url);
		if (!hasPermissionIn(locals.permissions, 'sale.mark_uncollectible'))
			return fail(403, { form, errors: {}, message: 'No hay permiso para esta acción.' });
		const data = await request.formData();
		const values = { reason: field(data, 'reason') };
		const missingSale = await saleForAction(locals, params, form, values);
		if (missingSale) return missingSale;
		try {
			await markSaleUncollectible(
				locals.supabase,
				{ saleId: params.saleId, ...values },
				{ requestId: locals.requestId ?? null, permissions: locals.permissions ?? null }
			);
			return { form, success: true, message: 'Venta marcada como incobrable.', errors: {} };
		} catch (cause) {
			const service = cause instanceof SaleServiceError ? cause : null;
			return fail(service?.status ?? 500, {
				form,
				values,
				errors: service?.field ? { [service.field]: [service.message] } : {},
				message: service?.message ?? 'No se pudo marcar la venta como incobrable.'
			});
		}
	},
	correctBuyer: async ({ request, locals, params, url }) => {
		if (permissionsUnavailable(locals.permissions))
			return fail(500, {
				form: 'correctBuyer',
				errors: {},
				message: 'No se pudieron cargar los permisos.'
			});
		requireCampaignViewer(locals, url);
		if (!hasPermissionIn(locals.permissions, 'sale.correct'))
			return fail(403, {
				form: 'correctBuyer',
				errors: {},
				message: 'No hay permiso para esta acción.'
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
			return { form: 'correctBuyer', success: true, message: 'Comprador corregido.', errors: {} };
		} catch (cause) {
			return correctionFailure(cause, 'correctBuyer', values);
		}
	},
	correctCollector: async ({ request, locals, params, url }) => {
		if (permissionsUnavailable(locals.permissions))
			return fail(500, {
				form: 'correctCollector',
				errors: {},
				message: 'No se pudieron cargar los permisos.'
			});
		requireCampaignViewer(locals, url);
		if (!hasPermissionIn(locals.permissions, 'sale.correct'))
			return fail(403, {
				form: 'correctCollector',
				errors: {},
				message: 'No hay permiso para esta acción.'
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
				message: 'Cobrador corregido.',
				errors: {}
			};
		} catch (cause) {
			return correctionFailure(cause, 'correctCollector', values);
		}
	}
};

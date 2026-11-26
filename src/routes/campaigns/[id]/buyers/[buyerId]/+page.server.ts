import { error, fail } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import {
	hasPermissionIn,
	permissionsUnavailable,
	requirePermissionIn
} from '$lib/server/auth/permissions';
import { buyerDisplayName } from '$lib/domain/parties';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import {
	AUDIT_ENTRIES_LIMIT,
	listAuditEntriesForEntities
} from '$lib/server/repositories/audit-log';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import {
	findBuyersByIdentification,
	getBuyer,
	getCollector,
	listActiveCollectorOptions,
	listBuyerBonds
} from '$lib/server/repositories/parties';
import { updateBuyer } from '$lib/server/services/parties';
import {
	listBuyerSalesAndInstallments,
	listInstallmentPaymentsForSale,
	listInstallmentsForSale
} from '$lib/server/repositories/sales';
import { isReadableName } from '$lib/domain/parties';
import { todayInBuenosAires } from '$lib/domain/reports';
import { CAMPAIGN_MESSAGES } from '$lib/server/services/campaigns';
import {
	buyerValues,
	duplicateFailure,
	partyFailure,
	requireBuyerManage,
	validateBuyer
} from '$lib/server/buyers/route-helpers';
import { listBuyerPrizes } from '$lib/server/repositories/prizes';

const valid = (id: string) => z.guid().safeParse(id).success;
/**
 * How many of the buyer's active sales the record reads in full (installments and payments, two
 * small reads each) to say what is owed. A buyer rarely has more than a few bonds in a campaign.
 */
const SALES_DETAILED = 20;
export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (permissionsUnavailable(locals.permissions))
		error(500, { message: 'No se pudieron cargar los permisos.' });
	requireCampaignViewer(locals, url);
	if (!hasPermissionIn(locals.permissions, 'buyer.view'))
		requirePermissionIn(locals.permissions, 'buyer.manage');
	if (!valid(params.id)) error(404, { message: CAMPAIGN_MESSAGES.notFound });
	if (!valid(params.buyerId)) error(404, { message: 'No se encontró el comprador.' });
	const [campaignResult, buyerResult, optionsResult] = await Promise.all([
		getCampaignById(locals.supabase, params.id),
		getBuyer(locals.supabase, params.buyerId),
		listActiveCollectorOptions(locals.supabase)
	]);
	if (campaignResult.error || buyerResult.error || optionsResult.error)
		error(500, { message: 'No se pudo cargar el comprador. Volver a intentar.' });
	if (!campaignResult.data) error(404, { message: CAMPAIGN_MESSAGES.notFound });
	if (!buyerResult.data) error(404, { message: 'No se encontró el comprador.' });
	const buyer = buyerResult.data;
	const canViewPrizes = (
		['draw.view', 'draw.load_winner', 'prize.resolve', 'prize.deliver', 'prize.annul'] as const
	).some((permission) => hasPermissionIn(locals.permissions, permission));
	const [
		collectorResult,
		auditResult,
		campaignBondsResult,
		historicalBondsResult,
		salesResult,
		prizesResult
	] = await Promise.all([
		buyer.usualCollectorId
			? getCollector(locals.supabase, buyer.usualCollectorId)
			: Promise.resolve({ data: null, error: null }),
		hasPermissionIn(locals.permissions, 'audit.view')
			? listAuditEntriesForEntities(locals.supabase, 'buyer', [buyer.id], {
					limit: AUDIT_ENTRIES_LIMIT + 1
				})
			: Promise.resolve(null),
		listBuyerBonds(locals.supabase, buyer.id, { campaignId: campaignResult.data.id }),
		listBuyerBonds(locals.supabase, buyer.id, { excludeCampaignId: campaignResult.data.id }),
		listBuyerSalesAndInstallments(locals.supabase, campaignResult.data.id, buyer.id),
		canViewPrizes
			? listBuyerPrizes(locals.supabase, campaignResult.data.id, buyer.id)
			: Promise.resolve({ data: [], error: null })
	]);
	if (
		collectorResult.error ||
		auditResult?.error ||
		campaignBondsResult.error ||
		historicalBondsResult.error ||
		salesResult.error ||
		prizesResult.error
	)
		error(500, { message: 'No se pudo cargar el comprador. Volver a intentar.' });
	// What is owed (UX plan PR 15): the installments of each active sale with what its payments
	// applied, the same two reads as the bond and sale records, with the caller's client. A role that
	// cannot read payments gets none, and the record falls back to the installments' own statuses.
	const sales = salesResult.data?.sales ?? [];
	const detailed = sales.filter((item) => item.sale.status === 'active').slice(0, SALES_DETAILED);
	const details = await Promise.all(
		detailed.map(async (item) => {
			const [installments, payments] = await Promise.all([
				listInstallmentsForSale(locals.supabase, item.sale.id),
				listInstallmentPaymentsForSale(locals.supabase, item.sale.id)
			]);
			return { saleId: item.sale.id, installments, payments };
		})
	);
	if (details.some((detail) => detail.installments.error || detail.payments.error))
		error(500, { message: 'No se pudo cargar el comprador. Volver a intentar.' });
	const can = (...permissions: Parameters<typeof hasPermissionIn>[1][]) =>
		permissions.some((permission) => hasPermissionIn(locals.permissions, permission));
	return {
		campaign: campaignResult.data,
		buyer,
		today: todayInBuenosAires(),
		/**
		 * `sale id -> installments` of the active sales read in full, each with what confirmed payments
		 * applied to it. A sale that is not here is listed without its debt.
		 */
		saleInstallments: Object.fromEntries(
			details.map((detail) => [
				detail.saleId,
				(detail.installments.data ?? []).map((installment) => ({
					number: installment.installmentNumber,
					dueDate: installment.dueDate,
					amount: installment.amount,
					applied: detail.payments.data?.get(installment.id)?.applied ?? '0.00',
					status: installment.status
				}))
			])
		),
		/** `sale id -> collector name`, only the names the role can read. */
		saleCollectors: Object.fromEntries(
			sales.flatMap((item) =>
				isReadableName(item.collectorName) ? [[item.sale.id, item.collectorName]] : []
			)
		),
		/** Without it, payments cannot be read: the record says so instead of guessing balances. */
		canViewPayments: can('payment.view', 'payment.create', 'payment.annul'),
		/** The role may load a payment in a settlement. */
		canPay: can('settlement.create', 'settlement.update_open'),
		collector: collectorResult.data,
		collectors: [
			...(optionsResult.data ?? []),
			...(collectorResult.data &&
			!optionsResult.data?.some((option) => option.id === collectorResult.data!.id)
				? [
						{
							id: collectorResult.data.id,
							displayName: `${collectorResult.data.displayName}${collectorResult.data.status === 'inactive' ? ' (inactivo)' : ''}`
						}
					]
				: [])
		],
		usualCollectorNotVisible: Boolean(buyer.usualCollectorId && !collectorResult.data),
		canViewCollectors:
			hasPermissionIn(locals.permissions, 'collector.view') ||
			hasPermissionIn(locals.permissions, 'collector.manage'),
		campaignBonds: campaignBondsResult.data ?? [],
		historicalBonds: historicalBondsResult.data ?? [],
		sales,
		salesTotal: salesResult.data?.salesTotal ?? 0,
		installments: salesResult.data?.installments ?? [],
		installmentsTotal: salesResult.data?.installmentsTotal ?? 0,
		prizes: prizesResult.data ?? [],
		canViewPrizes,
		canManage: hasPermissionIn(locals.permissions, 'buyer.manage'),
		audit: auditResult
			? {
					entries: (auditResult.data ?? []).slice(0, AUDIT_ENTRIES_LIMIT),
					truncated: (auditResult.data?.length ?? 0) > AUDIT_ENTRIES_LIMIT
				}
			: null
	};
};
export const actions: Actions = {
	update: async ({ request, locals, params, url }) => {
		if (permissionsUnavailable(locals.permissions))
			return fail(500, {
				success: false,
				values: {},
				errors: {},
				message: 'No se pudieron cargar los permisos.'
			});
		const denied = requireBuyerManage(locals, url);
		if (denied) return denied;
		if (!valid(params.id))
			return fail(404, {
				success: false,
				values: {},
				errors: {},
				message: CAMPAIGN_MESSAGES.notFound
			});
		if (!valid(params.buyerId))
			return fail(404, {
				success: false,
				values: {},
				errors: {},
				message: 'No se encontró el comprador.'
			});
		const formData = await request.formData();
		const values = buyerValues(formData);
		const current = await getBuyer(locals.supabase, params.buyerId);
		if (current.error) return partyFailure(current.error, values);
		if (!current.data)
			return fail(404, {
				success: false,
				values,
				errors: {},
				message: 'No se encontró el comprador.'
			});
		const keepCollector = values.usualCollectorId === '__keep__';
		if (keepCollector && !current.data.usualCollectorId)
			return fail(400, {
				success: false,
				values,
				errors: { usualCollectorId: ['No hay un cobrador habitual para conservar.'] },
				message: 'Revisar los campos marcados.'
			});
		const valuesToValidate = keepCollector
			? { ...values, usualCollectorId: current.data.usualCollectorId }
			: values;
		const campaign = await getCampaignById(locals.supabase, params.id);
		if (campaign.error) return partyFailure(campaign.error, values);
		if (!campaign.data)
			return fail(404, {
				success: false,
				values,
				errors: {},
				message: CAMPAIGN_MESSAGES.notFound
			});
		const updatedAt = String(formData.get('updatedAt') ?? '');
		if (!z.iso.datetime({ offset: true }).safeParse(updatedAt).success)
			return fail(400, {
				success: false,
				values,
				errors: {
					updatedAt: [
						'La versión del registro no es válida. Recargar la página y volver a intentar.'
					]
				},
				message: 'Revisar los campos marcados.'
			});
		const checked = formData.get('createAnyway') === 'on';
		const parsed = validateBuyer(valuesToValidate);
		if ('failure' in parsed) return parsed.failure;
		const idChanged =
			parsed.data.documentNumber !== current.data.documentNumber ||
			parsed.data.taxId !== current.data.taxId;
		if (idChanged) {
			const duplicates = await findBuyersByIdentification(locals.supabase, {
				...parsed.data,
				excludeId: params.buyerId
			});
			if (duplicates.error) return partyFailure(duplicates.error, values);
			if ((duplicates.data?.length ?? 0) && !checked)
				return duplicateFailure(
					values,
					duplicates.data!.map((b) => ({ id: b.id, name: buyerDisplayName(b) }))
				);
		}
		try {
			await updateBuyer(locals.supabase, params.buyerId, parsed.data, updatedAt, {
				requestId: locals.requestId,
				permissions: locals.permissions
			});
			return { success: true, message: 'Comprador actualizado.', errors: {}, values };
		} catch (err) {
			return partyFailure(err, values);
		}
	}
};

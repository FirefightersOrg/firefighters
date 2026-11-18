import { error, fail } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { hasPermissionIn, requirePermissionIn } from '$lib/server/auth/permissions';
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
import { CAMPAIGN_MESSAGES } from '$lib/server/services/campaigns';
import {
	buyerValues,
	duplicateFailure,
	partyFailure,
	requireBuyerManage,
	validateBuyer
} from '$lib/server/buyers/route-helpers';

const valid = (id: string) => z.guid().safeParse(id).success;
export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireCampaignViewer(locals, url);
	if (!hasPermissionIn(locals.permissions, 'buyer.view'))
		requirePermissionIn(locals.permissions, 'buyer.manage');
	if (!valid(params.id)) error(404, { message: CAMPAIGN_MESSAGES.notFound });
	if (!valid(params.buyerId)) error(404, { message: 'Buyer not found.' });
	const [campaignResult, buyerResult, optionsResult] = await Promise.all([
		getCampaignById(locals.supabase, params.id),
		getBuyer(locals.supabase, params.buyerId),
		listActiveCollectorOptions(locals.supabase)
	]);
	if (campaignResult.error || buyerResult.error || optionsResult.error)
		error(500, { message: 'Could not load the buyer. Please try again.' });
	if (!campaignResult.data) error(404, { message: CAMPAIGN_MESSAGES.notFound });
	if (!buyerResult.data) error(404, { message: 'Buyer not found.' });
	const buyer = buyerResult.data;
	const [collectorResult, auditResult, campaignBondsResult, historicalBondsResult] =
		await Promise.all([
			buyer.usualCollectorId
				? getCollector(locals.supabase, buyer.usualCollectorId)
				: Promise.resolve({ data: null, error: null }),
			hasPermissionIn(locals.permissions, 'audit.view')
				? listAuditEntriesForEntities(locals.supabase, 'buyer', [buyer.id], {
						limit: AUDIT_ENTRIES_LIMIT + 1
					})
				: Promise.resolve(null),
			listBuyerBonds(locals.supabase, buyer.id, { campaignId: campaignResult.data.id }),
			listBuyerBonds(locals.supabase, buyer.id, { excludeCampaignId: campaignResult.data.id })
		]);
	if (
		collectorResult.error ||
		auditResult?.error ||
		campaignBondsResult.error ||
		historicalBondsResult.error
	)
		error(500, { message: 'Could not load the buyer. Please try again.' });
	return {
		campaign: campaignResult.data,
		buyer,
		collector: collectorResult.data,
		collectors: [
			...(optionsResult.data ?? []),
			...(collectorResult.data &&
			!optionsResult.data?.some((option) => option.id === collectorResult.data!.id)
				? [
						{
							id: collectorResult.data.id,
							displayName: `${collectorResult.data.displayName}${collectorResult.data.status === 'inactive' ? ' (inactive)' : ''}`
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
			return fail(404, { success: false, values: {}, errors: {}, message: 'Buyer not found.' });
		const formData = await request.formData();
		const values = buyerValues(formData);
		const current = await getBuyer(locals.supabase, params.buyerId);
		if (current.error) return partyFailure(current.error, values);
		if (!current.data)
			return fail(404, { success: false, values, errors: {}, message: 'Buyer not found.' });
		const keepCollector = values.usualCollectorId === '__keep__';
		if (keepCollector && !current.data.usualCollectorId)
			return fail(400, {
				success: false,
				values,
				errors: { usualCollectorId: ['There is no usual collector to keep.'] },
				message: 'Please correct the highlighted fields.'
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
				errors: { updatedAt: ['Invalid update version. Refresh the page and try again.'] },
				message: 'Please correct the highlighted fields.'
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
			return { success: true, message: 'Buyer updated.', errors: {}, values };
		} catch (err) {
			return partyFailure(err, values);
		}
	}
};

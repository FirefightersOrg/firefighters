import { error, fail } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { hasPermissionIn, requirePermissionIn } from '$lib/server/auth/permissions';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import {
	AUDIT_ENTRIES_LIMIT,
	listAuditEntriesForEntities
} from '$lib/server/repositories/audit-log';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import {
	getCollector,
	getProfileName,
	listAssignedBondsForCollector,
	listAvailableCollectorProfileOptions,
	listBuyers
} from '$lib/server/repositories/parties';
import { PartyServiceError, updateCollector } from '$lib/server/services/parties';
import { CAMPAIGN_MESSAGES } from '$lib/server/services/campaigns';
import { COLLECTOR_UPDATE_FIELDS, collectorSchema } from '$lib/schemas/collector';
import { readFormFields } from '$lib/schemas/campaign';
const uuid = (value: string) => z.guid().safeParse(value).success;
const notFound = 'Collector not found.';
/** Usual buyers listed on the record; the rest are counted ("and N more"). */
const BUYERS_SHOWN = 100;
const isTimestamp = (value: string) => z.iso.datetime({ offset: true }).safeParse(value).success;
export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireCampaignViewer(locals, url);
	if (!hasPermissionIn(locals.permissions, 'collector.view'))
		requirePermissionIn(locals.permissions, 'collector.manage');
	if (!uuid(params.id)) error(404, { message: CAMPAIGN_MESSAGES.notFound });
	if (!uuid(params.collectorId)) error(404, { message: notFound });
	const [campaignResult, collectorResult] = await Promise.all([
		getCampaignById(locals.supabase, params.id),
		getCollector(locals.supabase, params.collectorId)
	]);
	if (campaignResult.error || collectorResult.error)
		error(500, { message: 'Could not load the collector. Please try again.' });
	if (!campaignResult.data) error(404, { message: CAMPAIGN_MESSAGES.notFound });
	if (!collectorResult.data) error(404, { message: notFound });
	const auditAllowed = hasPermissionIn(locals.permissions, 'audit.view');
	const [bonds, buyers, profiles, audit] = await Promise.all([
		listAssignedBondsForCollector(locals.supabase, params.id, params.collectorId),
		listBuyers(locals.supabase, { usualCollectorId: params.collectorId, pageSize: BUYERS_SHOWN }),
		listAvailableCollectorProfileOptions(locals.supabase),
		auditAllowed
			? listAuditEntriesForEntities(locals.supabase, 'collector', [params.collectorId], {
					limit: AUDIT_ENTRIES_LIMIT + 1
				})
			: Promise.resolve(null)
	]);
	if (bonds.error || buyers.error || profiles.error || audit?.error)
		error(500, { message: 'Could not load the collector. Please try again.' });
	const collector = collectorResult.data;
	const profileOptions = profiles.data ?? [];
	if (collector.userProfileId) {
		// The admin can read profiles; anyone else sees a generic label.
		const linked = await getProfileName(locals.supabase, collector.userProfileId);
		profileOptions.unshift({
			id: collector.userProfileId,
			fullName: linked.data ?? 'Current linked user',
			email: ''
		});
	}
	return {
		campaign: campaignResult.data,
		collector,
		bonds: bonds.data?.items ?? [],
		bondsTotal: bonds.data?.total ?? 0,
		buyers: buyers.data?.items ?? [],
		buyersTotal: buyers.data?.total ?? 0,
		profiles: profileOptions,
		can: { manage: hasPermissionIn(locals.permissions, 'collector.manage'), audit: auditAllowed },
		audit: auditAllowed
			? {
					entries: (audit?.data ?? []).slice(0, AUDIT_ENTRIES_LIMIT),
					truncated: (audit?.data?.length ?? 0) > AUDIT_ENTRIES_LIMIT
				}
			: null
	};
};
export const actions: Actions = {
	update: async ({ request, locals, params, url }) => {
		requireCampaignViewer(locals, url);
		requirePermissionIn(locals.permissions, 'collector.manage');
		if (!uuid(params.id)) return fail(404, { message: CAMPAIGN_MESSAGES.notFound });
		if (!uuid(params.collectorId)) return fail(404, { message: notFound });
		const values = readFormFields(await request.formData(), COLLECTOR_UPDATE_FIELDS);
		// A stale-check token that is not a timestamp is a bad request, not a database cast error.
		if (!isTimestamp(values.updatedAt))
			return fail(400, {
				values,
				errors: {},
				message: 'The form is out of date. Reload the page and try again.'
			});
		const parsed = collectorSchema.safeParse(values);
		if (!parsed.success)
			return fail(400, {
				values,
				errors: parsed.error.flatten().fieldErrors,
				message: 'Please review the form.'
			});
		try {
			await updateCollector(locals.supabase, params.collectorId, parsed.data, values.updatedAt, {
				requestId: locals.requestId,
				permissions: locals.permissions
			});
			return { success: true, message: 'Collector updated.', errors: {} };
		} catch (err) {
			const party = err instanceof PartyServiceError ? err : null;
			return fail(party?.status ?? 500, {
				values,
				errors: party?.field ? { [party.field]: [party.message] } : {},
				message: party?.message ?? 'Something went wrong. Please try again.'
			});
		}
	}
};

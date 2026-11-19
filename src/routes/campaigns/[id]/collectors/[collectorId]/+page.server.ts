import { error, fail, redirect } from '@sveltejs/kit';
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
import { canDeliverBonds, canLoadBonds } from '$lib/domain/campaigns';
import { DELIVERY_MAX_BONDS } from '$lib/domain/deliveries';
import { requireActiveUser } from '$lib/server/auth/guards';
import { listActiveAssignmentNotes } from '$lib/server/repositories/deliveries';
import { listActiveCollectorOptions } from '$lib/server/repositories/parties';
import { listCollectorPendingInstallments } from '$lib/server/repositories/sales';
import {
	DeliveryServiceError,
	reassignBondsToCollector,
	returnBondsFromCollector
} from '$lib/server/services/deliveries';
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
	const [bonds, buyers, profiles, audit, installments] = await Promise.all([
		listAssignedBondsForCollector(locals.supabase, params.id, params.collectorId),
		listBuyers(locals.supabase, { usualCollectorId: params.collectorId, pageSize: BUYERS_SHOWN }),
		listAvailableCollectorProfileOptions(locals.supabase),
		auditAllowed
			? listAuditEntriesForEntities(locals.supabase, 'collector', [params.collectorId], {
					limit: AUDIT_ENTRIES_LIMIT + 1
				})
			: Promise.resolve(null),
		listCollectorPendingInstallments(locals.supabase, params.id, params.collectorId)
	]);
	if (bonds.error || buyers.error || profiles.error || audit?.error || installments.error)
		error(500, { message: 'Could not load the collector. Please try again.' });
	const collector = collectorResult.data;
	const assigned = bonds.data?.items ?? [];

	// Custody (SAN-55): the note behind each held bond, and bulk return / reassignment.
	const custodyCan = {
		returnBonds:
			canLoadBonds(campaignResult.data.status) &&
			hasPermissionIn(locals.permissions, 'bond.return'),
		reassignBonds:
			canDeliverBonds(campaignResult.data.status) &&
			hasPermissionIn(locals.permissions, 'bond.assign')
	};
	const [notes, targets] = await Promise.all([
		listActiveAssignmentNotes(
			locals.supabase,
			assigned.map((b) => b.id)
		),
		custodyCan.reassignBonds
			? listActiveCollectorOptions(locals.supabase)
			: Promise.resolve({ data: [], error: null })
	]);
	if (notes.error || targets.error)
		error(500, { message: 'Could not load the collector. Please try again.' });

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
		bonds: assigned.map((bond) => ({ ...bond, note: notes.data?.get(bond.id) ?? null })),
		custody: {
			can: custodyCan,
			collectors: (targets.data ?? []).filter((c) => c.id !== params.collectorId)
		},
		bondsTotal: bonds.data?.total ?? 0,
		buyers: buyers.data?.items ?? [],
		buyersTotal: buyers.data?.total ?? 0,
		installments: installments.data?.items ?? [],
		installmentsTotal: installments.data?.total ?? 0,
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
	},
	returnBonds: async ({ request, locals, params, url }) => {
		const checked = await custodyRequest(locals, url, params, request, 'bond.return');
		if ('failure' in checked) return checked.failure;
		let noteId: string;
		try {
			noteId = await returnBondsFromCollector(
				locals.supabase,
				{
					campaignId: params.id,
					bondIds: checked.bondIds,
					notes: null,
					fromCollectorId: params.collectorId
				},
				{ requestId: locals.requestId, permissions: locals.permissions }
			);
		} catch (err) {
			return custodyServiceFailure(err);
		}
		redirect(303, `/campaigns/${params.id}/deliveries/${noteId}`);
	},

	reassignBonds: async ({ request, locals, params, url }) => {
		const checked = await custodyRequest(locals, url, params, request, 'bond.assign');
		if ('failure' in checked) return checked.failure;
		const target = checked.formData.get('targetCollectorId');
		if (typeof target !== 'string' || !uuid(target) || target === params.collectorId) {
			return custodyFailure(400, 'Choose the collector that receives the bonds.', {
				targetCollectorId: ['Choose the collector that receives the bonds.']
			});
		}
		let noteId: string;
		try {
			noteId = await reassignBondsToCollector(
				locals.supabase,
				{
					campaignId: params.id,
					collectorId: target,
					bondIds: checked.bondIds,
					notes: null,
					fromCollectorId: params.collectorId
				},
				{ requestId: locals.requestId, permissions: locals.permissions }
			);
		} catch (err) {
			return custodyServiceFailure(err);
		}
		redirect(303, `/campaigns/${params.id}/deliveries/${noteId}`);
	}
};

function custodyFailure(status: number, message: string, errors: Record<string, string[]> = {}) {
	return fail(status, { form: 'custody' as const, success: false, message, errors });
}

function custodyServiceFailure(err: unknown) {
	if (!(err instanceof DeliveryServiceError)) throw err;
	const field = err.field === 'collectorId' ? 'targetCollectorId' : 'bondIds';
	return custodyFailure(err.status, err.message, { [field]: [err.message] });
}

/** Active user, permission, ids and the checked bonds of a bulk custody form. */
async function custodyRequest(
	locals: App.Locals,
	url: URL,
	params: { id: string; collectorId: string },
	request: Request,
	permission: 'bond.return' | 'bond.assign'
): Promise<
	{ failure: ReturnType<typeof custodyFailure> } | { bondIds: string[]; formData: FormData }
> {
	requireActiveUser(locals, url.pathname);
	if (!hasPermissionIn(locals.permissions, permission)) {
		return { failure: custodyFailure(403, 'You do not have permission to do this.') };
	}
	if (!uuid(params.id)) return { failure: custodyFailure(404, CAMPAIGN_MESSAGES.notFound) };
	if (!uuid(params.collectorId)) return { failure: custodyFailure(404, notFound) };
	const formData = await request.formData();
	const bondIds = [
		...new Set(formData.getAll('bondIds').filter((v): v is string => typeof v === 'string'))
	];
	if (bondIds.length === 0) {
		return {
			failure: custodyFailure(400, 'Select at least one bond.', {
				bondIds: ['Select at least one bond.']
			})
		};
	}
	if (bondIds.length > DELIVERY_MAX_BONDS || !bondIds.every(uuid)) {
		return {
			failure: custodyFailure(400, `Select at most ${DELIVERY_MAX_BONDS} bonds.`, {
				bondIds: [`Select at most ${DELIVERY_MAX_BONDS} bonds.`]
			})
		};
	}
	return { bondIds, formData };
}

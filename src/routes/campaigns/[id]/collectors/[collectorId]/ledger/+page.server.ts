import { error, fail } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { hasPermissionIn, requirePermissionIn } from '$lib/server/auth/permissions';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { getCollector } from '$lib/server/repositories/parties';
import { CAMPAIGN_MESSAGES } from '$lib/server/services/campaigns';
import {
	CommissionLedgerServiceError,
	adjustCollectorLedger,
	adjustCommission,
	annulCollectorLedgerEntry,
	listCollectorLedger
} from '$lib/server/services/commission-ledger';
import { LEDGER_REASON_MAX } from '$lib/domain/ledger';

/**
 * /campaigns/[id]/collectors/[collectorId]/ledger: the Collector Current Account (SAN-69).
 * Reading needs `collector.ledger.view` or `collector.ledger.adjust`. Manual commission
 * adjustments need `commission.adjust`; ledger adjustments and annulments need
 * `collector.ledger.adjust`. The SQL functions check the same permissions again.
 */
const isUuid = (value: string) => z.guid().safeParse(value).success;
const notFound = 'Collector not found.';
type FormName = 'commission' | 'ledger' | 'annul';

function failure(
	form: FormName,
	status: number,
	message: string,
	errors: Record<string, string[]> = {}
) {
	return fail(status, { form, success: false, message, errors });
}

function serviceFailure(form: FormName, err: unknown) {
	if (!(err instanceof CommissionLedgerServiceError)) throw err;
	return failure(form, err.status, err.message);
}

function readText(data: FormData, name: string) {
	const value = data.get(name);
	return typeof value === 'string' ? value.trim() : '';
}

/** Amount and reason fields shared by both adjustment forms. */
function readAdjustment(data: FormData) {
	const amount = readText(data, 'amount');
	const reason = readText(data, 'reason');
	const errors: Record<string, string[]> = {};
	if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0)
		errors.amount = ['Enter a positive amount with at most 2 decimals.'];
	if (!reason || reason.length > LEDGER_REASON_MAX)
		errors.reason = [`Enter a reason of at most ${LEDGER_REASON_MAX} characters.`];
	return { amount, reason, errors };
}

export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireCampaignViewer(locals, url);
	if (!hasPermissionIn(locals.permissions, 'collector.ledger.view'))
		requirePermissionIn(locals.permissions, 'collector.ledger.adjust');
	if (!isUuid(params.id)) error(404, { message: CAMPAIGN_MESSAGES.notFound });
	if (!isUuid(params.collectorId)) error(404, { message: notFound });
	const [campaign, collector] = await Promise.all([
		getCampaignById(locals.supabase, params.id),
		getCollector(locals.supabase, params.collectorId)
	]);
	if (campaign.error || collector.error)
		error(500, { message: 'Could not load the current account. Please try again.' });
	if (!campaign.data) error(404, { message: CAMPAIGN_MESSAGES.notFound });
	if (!collector.data) error(404, { message: notFound });
	let entries;
	try {
		entries = await listCollectorLedger(locals.supabase, {
			campaignId: params.id,
			collectorId: params.collectorId
		});
	} catch (err) {
		if (err instanceof CommissionLedgerServiceError && err.kind === 'permission')
			error(403, { message: err.message });
		error(500, { message: 'Could not load the current account. Please try again.' });
	}
	return {
		campaign: campaign.data,
		collector: collector.data,
		entries,
		balance: entries.length ? entries[entries.length - 1].runningBalance : 0,
		reasonMax: LEDGER_REASON_MAX,
		can: {
			adjustCommission: hasPermissionIn(locals.permissions, 'commission.adjust'),
			adjustLedger: hasPermissionIn(locals.permissions, 'collector.ledger.adjust')
		}
	};
};

export const actions: Actions = {
	adjustCommission: async ({ request, locals, params, url }) => {
		requireCampaignViewer(locals, url);
		if (!hasPermissionIn(locals.permissions, 'commission.adjust'))
			return failure('commission', 403, 'You do not have permission to adjust commissions.');
		if (!isUuid(params.id) || !isUuid(params.collectorId))
			return failure('commission', 404, notFound);
		const data = await request.formData();
		const { amount, reason, errors } = readAdjustment(data);
		const direction = readText(data, 'direction');
		if (direction !== 'in_favor_of_collector' && direction !== 'in_favor_of_firefighters')
			errors.direction = ['Choose who the adjustment favors.'];
		if (Object.keys(errors).length)
			return failure('commission', 400, 'Please review the adjustment.', errors);
		try {
			await adjustCommission(
				locals.supabase,
				{
					campaignId: params.id,
					collectorId: params.collectorId,
					amount,
					direction: direction as 'in_favor_of_collector' | 'in_favor_of_firefighters',
					reason
				},
				{ requestId: locals.requestId }
			);
			return {
				form: 'commission' as const,
				success: true,
				message: 'Commission adjusted.',
				errors: {}
			};
		} catch (err) {
			return serviceFailure('commission', err);
		}
	},

	adjustLedger: async ({ request, locals, params, url }) => {
		requireCampaignViewer(locals, url);
		if (!hasPermissionIn(locals.permissions, 'collector.ledger.adjust'))
			return failure('ledger', 403, 'You do not have permission to adjust the current account.');
		if (!isUuid(params.id) || !isUuid(params.collectorId)) return failure('ledger', 404, notFound);
		const data = await request.formData();
		const { amount, reason, errors } = readAdjustment(data);
		const direction = readText(data, 'direction');
		if (direction !== 'collector_credit' && direction !== 'collector_debit')
			errors.direction = ['Choose credit or debit.'];
		if (Object.keys(errors).length)
			return failure('ledger', 400, 'Please review the adjustment.', errors);
		try {
			await adjustCollectorLedger(
				locals.supabase,
				{
					campaignId: params.id,
					collectorId: params.collectorId,
					amount,
					direction: direction as 'collector_credit' | 'collector_debit',
					reason
				},
				{ requestId: locals.requestId }
			);
			return {
				form: 'ledger' as const,
				success: true,
				message: 'Current account adjusted.',
				errors: {}
			};
		} catch (err) {
			return serviceFailure('ledger', err);
		}
	},

	annul: async ({ request, locals, url }) => {
		requireCampaignViewer(locals, url);
		if (!hasPermissionIn(locals.permissions, 'collector.ledger.adjust'))
			return failure('annul', 403, 'You do not have permission to annul entries.');
		const data = await request.formData();
		const entryId = readText(data, 'entryId');
		const reason = readText(data, 'reason');
		if (!isUuid(entryId)) return failure('annul', 400, 'Choose an entry to annul.');
		if (!reason || reason.length > LEDGER_REASON_MAX)
			return failure('annul', 400, 'Please review the annulment.', {
				reason: [`Enter a reason of at most ${LEDGER_REASON_MAX} characters.`]
			});
		try {
			await annulCollectorLedgerEntry(
				locals.supabase,
				{ entryId, reason },
				{ requestId: locals.requestId }
			);
			return { form: 'annul' as const, success: true, message: 'Entry annulled.', errors: {} };
		} catch (err) {
			return serviceFailure('annul', err);
		}
	}
};

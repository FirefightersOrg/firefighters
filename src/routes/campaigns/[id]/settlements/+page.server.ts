import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import {
	hasPermissionIn,
	permissionsUnavailable,
	requirePermissionIn
} from '$lib/server/auth/permissions';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { listActiveCollectorOptions } from '$lib/server/repositories/parties';
import { listSettlements } from '$lib/server/repositories/settlements';
import { SETTLEMENT_STATUSES, type SettlementStatus } from '$lib/domain/payments';
import type { PermissionCode } from '$lib/server/auth/permission-codes';

const uuid = (value: string) => /^[0-9a-f-]{36}$/i.test(value);
export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (permissionsUnavailable(locals.permissions))
		error(500, { message: 'Could not load permissions.' });
	requireCampaignViewer(locals, url);
	const canRead = (
		[
			'settlement.view',
			'settlement.create',
			'settlement.update_open',
			'settlement.close',
			'settlement.correct'
		] as PermissionCode[]
	).some((p) => hasPermissionIn(locals.permissions, p));
	if (!canRead) requirePermissionIn(locals.permissions, 'settlement.view');
	const collector = url.searchParams.get('collector') ?? '';
	const status = url.searchParams.get('status') ?? '';
	const from = url.searchParams.get('from') ?? '';
	const to = url.searchParams.get('to') ?? '';
	const [campaign, collectors, settlements] = await Promise.all([
		getCampaignById(locals.supabase, params.id),
		listActiveCollectorOptions(locals.supabase),
		listSettlements(locals.supabase, params.id, {
			collectorId: uuid(collector) ? collector : null,
			status: SETTLEMENT_STATUSES.includes(status as SettlementStatus)
				? (status as SettlementStatus)
				: null,
			from: /^\d{4}-\d\d-\d\d$/.test(from) ? from : null,
			to: /^\d{4}-\d\d-\d\d$/.test(to) ? to : null
		})
	]);
	if (campaign.error || collectors.error || settlements.error)
		error(500, { message: 'Could not load settlements.' });
	if (!campaign.data) error(404, { message: 'Campaign not found.' });
	return {
		campaign: campaign.data,
		collectors: collectors.data ?? [],
		settlements: settlements.data ?? [],
		filters: { collector, status, from, to },
		can: { create: hasPermissionIn(locals.permissions, 'settlement.create') }
	};
};

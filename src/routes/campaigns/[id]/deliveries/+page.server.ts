import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { PageServerLoad } from './$types';
import { canDeliverBonds } from '$lib/domain/campaigns';
import { hasPermissionIn, requirePermissionIn } from '$lib/server/auth/permissions';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import { isUuid, loadDeliveryCampaign } from '$lib/server/deliveries/route-helpers';
import { listDeliveryNotes } from '$lib/server/repositories/deliveries';
import { listActiveCollectorOptions } from '$lib/server/repositories/parties';

const isDate = (value: string) => z.iso.date().safeParse(value).success;

/**
 * /campaigns/[id]/deliveries: the campaign's delivery notes, newest first, filterable by collector
 * (`?collector=`), note number (`?number=`) and issue date (`?from=` / `?to=`). Requires
 * `campaign.view` and `bond.view` or `bond.assign`.
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireCampaignViewer(locals, url);
	if (!hasPermissionIn(locals.permissions, 'bond.assign')) {
		requirePermissionIn(locals.permissions, 'bond.view');
	}
	const campaign = await loadDeliveryCampaign(locals, params.id);

	const sp = url.searchParams;
	const collector = sp.get('collector') ?? '';
	const numberText = sp.get('number') ?? '';
	const from = sp.get('from') ?? '';
	const to = sp.get('to') ?? '';
	const page = Math.max(1, Number.parseInt(sp.get('page') ?? '1', 10) || 1);
	const noteNumber = /^\d{1,9}$/.test(numberText) ? Number(numberText) : null;

	const [notes, collectors] = await Promise.all([
		listDeliveryNotes(locals.supabase, campaign.id, {
			collectorId: isUuid(collector) ? collector : null,
			noteNumber,
			from: isDate(from) ? from : null,
			to: isDate(to) ? to : null,
			page
		}),
		listActiveCollectorOptions(locals.supabase)
	]);
	if (notes.error || collectors.error) {
		console.error('[deliveries] list load failed', {
			requestId: locals.requestId,
			error: notes.error ?? collectors.error
		});
		error(500, { message: 'Could not load the delivery notes. Please try again.' });
	}

	return {
		campaign,
		notes: notes.data.items,
		pagination: {
			page: notes.data.page,
			pageSize: notes.data.pageSize,
			total: notes.data.total,
			pageCount: Math.max(1, Math.ceil(notes.data.total / notes.data.pageSize))
		},
		filters: { collector, number: numberText, from, to },
		collectors: collectors.data,
		can: {
			deliver:
				hasPermissionIn(locals.permissions, 'bond.assign') && canDeliverBonds(campaign.status)
		}
	};
};

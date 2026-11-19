import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { PageServerLoad } from './$types';
import {
	hasPermissionIn,
	permissionsUnavailable,
	requirePermissionIn
} from '$lib/server/auth/permissions';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { getSaleDetail } from '$lib/server/repositories/sales';
import { calculateFinancialStatus } from '$lib/domain/financial-status';

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
	const [campaign, sale] = await Promise.all([
		getCampaignById(locals.supabase, params.id),
		getSaleDetail(locals.supabase, params.id, params.saleId)
	]);
	if (campaign.error || sale.error) error(500, { message: 'Could not load sale.' });
	if (!campaign.data) error(404, { message: 'Campaign not found.' });
	if (!sale.data) error(404, { message: 'Sale not found.' });
	const today = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'America/Argentina/Buenos_Aires'
	}).format(new Date());
	return {
		campaign: campaign.data,
		sale: sale.data,
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

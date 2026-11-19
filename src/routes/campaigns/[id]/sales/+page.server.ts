import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { hasPermissionIn, requirePermissionIn } from '$lib/server/auth/permissions';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { listActiveCollectorOptions } from '$lib/server/repositories/parties';
import { listSales } from '$lib/server/repositories/sales';
import { FINANCIAL_STATUSES, type FinancialStatus } from '$lib/domain/financial-status';
import { PAYMENT_MODES, type PaymentMode } from '$lib/domain/sales';

const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value);

export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireCampaignViewer(locals, url);
	if (
		!hasPermissionIn(locals.permissions, 'sale.view') &&
		!hasPermissionIn(locals.permissions, 'sale.create')
	)
		requirePermissionIn(locals.permissions, 'bond.view');
	const campaign = await getCampaignById(locals.supabase, params.id);
	if (campaign.error) error(500, { message: 'Could not load sales.' });
	if (!campaign.data) error(404, { message: 'Campaign not found.' });
	const collector = url.searchParams.get('collector') ?? '';
	const buyer = url.searchParams.get('buyer') ?? '';
	const paymentMode = url.searchParams.get('paymentMode') ?? '';
	const financialStatus = url.searchParams.get('financialStatus') ?? '';
	const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
	const [sales, collectors] = await Promise.all([
		listSales(locals.supabase, campaign.data.id, {
			collectorId: uuid(collector) ? collector : null,
			buyerSearch: buyer || null,
			paymentMode: PAYMENT_MODES.includes(paymentMode as PaymentMode)
				? (paymentMode as PaymentMode)
				: null,
			financialStatus: FINANCIAL_STATUSES.includes(financialStatus as FinancialStatus)
				? (financialStatus as FinancialStatus)
				: null,
			page
		}),
		listActiveCollectorOptions(locals.supabase)
	]);
	if (sales.error || collectors.error) error(500, { message: 'Could not load sales.' });
	return {
		campaign: campaign.data,
		sales: sales.data.items,
		collectors: collectors.data ?? [],
		filters: { collector, buyer, paymentMode, financialStatus },
		pagination: {
			...sales.data,
			items: undefined,
			pageCount: Math.max(1, Math.ceil(sales.data.total / sales.data.pageSize))
		},
		can: { create: hasPermissionIn(locals.permissions, 'sale.create') }
	};
};

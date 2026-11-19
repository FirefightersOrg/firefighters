import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { z } from 'zod';
import { hasPermissionIn, requirePermissionIn } from '$lib/server/auth/permissions';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { getBuyer, listBuyers } from '$lib/server/repositories/parties';
import { findDeliveredBondsForSale } from '$lib/server/repositories/sales';
import { registerSale, SaleServiceError } from '$lib/server/services/sales';
import { PAYMENT_MODES, type PaymentMode } from '$lib/domain/sales';
import { createBuyer } from '$lib/server/services/parties';
import {
	buyerValues,
	duplicateFailure,
	partyFailure,
	validateBuyer
} from '$lib/server/buyers/route-helpers';
import { findBuyersByIdentification } from '$lib/server/repositories/parties';
import { buyerDisplayName } from '$lib/domain/parties';

const uuid = (value: string) => z.guid().safeParse(value).success;
const field = (form: FormData, name: string) => String(form.get(name) ?? '').trim();
const argentinaToday = () =>
	new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(
		new Date()
	);

export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireCampaignViewer(locals, url);
	requirePermissionIn(locals.permissions, 'sale.create');
	const [campaign, buyers] = await Promise.all([
		getCampaignById(locals.supabase, params.id),
		listBuyers(locals.supabase, { search: url.searchParams.get('buyer') ?? '', pageSize: 30 })
	]);
	if (campaign.error || buyers.error) error(500, { message: 'Could not load sale registration.' });
	if (!campaign.data) error(404, { message: 'Campaign not found.' });
	return {
		campaign: campaign.data,
		buyers: buyers.data?.items ?? [],
		canCreateBuyer: hasPermissionIn(locals.permissions, 'buyer.manage'),
		today: argentinaToday()
	};
};

export const actions: Actions = {
	lookup: async ({ request, locals, params, url }) => {
		requireCampaignViewer(locals, url);
		requirePermissionIn(locals.permissions, 'sale.create');
		const query = field(await request.formData(), 'query');
		if (!query)
			return fail(400, { form: 'lookup', errors: { query: ['Enter a bond number or code.'] } });
		const result = await findDeliveredBondsForSale(locals.supabase, params.id, query);
		if (result.error)
			return fail(500, { form: 'lookup', errors: {}, message: 'Could not search bonds.' });
		return { form: 'lookup', success: true, found: result.data, query, errors: {} };
	},
	createBuyer: async ({ request, locals, url }) => {
		requireCampaignViewer(locals, url);
		if (!hasPermissionIn(locals.permissions, 'buyer.manage'))
			return fail(403, {
				form: 'buyer',
				errors: {},
				message: 'You do not have permission to perform this action.'
			});
		const form = await request.formData();
		const values = buyerValues(form);
		const parsed = validateBuyer(values);
		if ('failure' in parsed)
			return fail(parsed.failure!.status, { ...(parsed.failure!.data ?? {}), form: 'buyer' });
		const duplicates = await findBuyersByIdentification(locals.supabase, parsed.data);
		if (duplicates.error) return partyFailure(duplicates.error, values);
		if ((duplicates.data?.length ?? 0) > 0 && form.get('createAnyway') !== 'on')
			return {
				...duplicateFailure(
					values,
					duplicates.data!.map((buyer) => ({ id: buyer.id, name: buyerDisplayName(buyer) }))
				).data,
				form: 'buyer'
			};
		try {
			const buyerId = await createBuyer(locals.supabase, parsed.data, {
				requestId: locals.requestId,
				permissions: locals.permissions
			});
			return { form: 'buyer', success: true, buyerId, message: 'Buyer created.', errors: {} };
		} catch (err) {
			return { ...partyFailure(err, values).data, form: 'buyer' };
		}
	},
	register: async ({ request, locals, params, url }) => {
		requireCampaignViewer(locals, url);
		if (!hasPermissionIn(locals.permissions, 'sale.create'))
			return fail(403, {
				form: 'sale',
				errors: {},
				message: 'You do not have permission to perform this action.'
			});
		const form = await request.formData();
		const values = {
			bondId: field(form, 'bondId'),
			buyerId: field(form, 'buyerId'),
			paymentMode: field(form, 'paymentMode'),
			firstDueDate: field(form, 'firstDueDate')
		};
		const errors: Record<string, string[]> = {};
		if (!uuid(values.bondId)) errors.bondId = ['Choose a delivered bond.'];
		if (!uuid(values.buyerId)) errors.buyerId = ['Choose a buyer.'];
		if (!PAYMENT_MODES.includes(values.paymentMode as PaymentMode))
			errors.paymentMode = ['Choose a payment mode.'];
		if (!z.iso.date().safeParse(values.firstDueDate).success)
			errors.firstDueDate = ['Choose the first due date.'];
		if (Object.keys(errors).length)
			return fail(400, {
				form: 'sale',
				values,
				errors,
				message: 'Please correct the highlighted fields.'
			});
		const campaign = await getCampaignById(locals.supabase, params.id);
		if (campaign.error)
			return fail(500, { form: 'sale', values, errors: {}, message: 'Could not load campaign.' });
		if (!campaign.data)
			return fail(404, { form: 'sale', values, errors: {}, message: 'Campaign not found.' });
		const [buyer, bond] = await Promise.all([
			getBuyer(locals.supabase, values.buyerId),
			findDeliveredBondsForSale(locals.supabase, params.id, values.bondId)
		]);
		if (buyer.error || bond.error)
			return fail(500, { form: 'sale', values, errors: {}, message: 'Could not validate sale.' });
		if (!buyer.data)
			return fail(404, {
				form: 'sale',
				values,
				errors: { buyerId: ['Buyer not found.'] },
				message: 'Buyer not found.'
			});
		// The server-side RPC remains authoritative; this prevents a hand-crafted form from showing
		// a misleading collector confirmation before it reaches the database.
		if (!bond.data.some((item) => item.id === values.bondId))
			return fail(409, {
				form: 'sale',
				values,
				errors: { bondId: ['This bond is not delivered to a collector and cannot be sold.'] },
				message: 'Bond is not available for sale.'
			});
		let saleId: string;
		try {
			saleId = await registerSale(
				locals.supabase,
				{ campaignId: params.id, ...values, paymentMode: values.paymentMode as PaymentMode },
				{ requestId: locals.requestId, permissions: locals.permissions }
			);
		} catch (err) {
			if (err instanceof SaleServiceError)
				return fail(err.status, {
					form: 'sale',
					values,
					errors: err.field ? { [err.field]: [err.message] } : {},
					message: err.message
				});
			throw err;
		}
		redirect(303, `/campaigns/${params.id}/sales/${saleId}`);
	}
};

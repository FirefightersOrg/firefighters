import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { z } from 'zod';
import { formatDate } from '$lib/format';
import {
	hasPermissionIn,
	permissionsUnavailable,
	requirePermissionIn
} from '$lib/server/auth/permissions';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { getBuyer, getCollectorsByIds, listBuyers } from '$lib/server/repositories/parties';
import { findBondsForSale } from '$lib/server/repositories/sales';
import { campaignNumberingConfig } from '$lib/domain/campaigns';
import { parseCampaignNumber } from '$lib/domain/numbering';
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
import { saleRegisterSchema } from '$lib/schemas/sale';

const uuid = (value: string) => z.guid().safeParse(value).success;
const field = (form: FormData, name: string) => String(form.get(name) ?? '').trim();
const argentinaToday = () =>
	new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(
		new Date()
	);
const addDays = (date: string, days: number) => {
	const [year, month, day] = date.split('-').map(Number);
	return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};
/** SAN-106: the first due date falls within [sale date, sale date + 1 year]. */
export const _firstDueDateBounds = (saleDate = argentinaToday()) => ({
	min: saleDate,
	max: addDays(saleDate, 365)
});
/** Buenos Aires calendar date of an instant. */
const argentinaDate = (iso: string) =>
	new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(
		new Date(iso)
	);
/** SAN-106: a sale may be dated back to the campaign start, never in the future. */
export const _saleDateBounds = (startsAt: string | null, today = argentinaToday()) => {
	const start = startsAt ? argentinaDate(startsAt) : today;
	return { min: start < today ? start : today, max: today };
};
const saleFormSchema = (campaignId: string, startsAt: string | null, today = argentinaToday()) => {
	const saleBounds = _saleDateBounds(startsAt, today);
	return saleRegisterSchema
		.extend({
			campaignId: z.literal(campaignId),
			firstDueDate: z.string().optional(),
			saleDate: z.string().optional()
		})
		.superRefine(({ paymentMode, firstDueDate, saleDate }, context) => {
			const sold = saleDate || today;
			// The campaign start only bounds an earlier date (a sale of today works as before).
			const tooEarly = sold < today && sold < saleBounds.min;
			if (!z.iso.date().safeParse(sold).success || tooEarly || sold > saleBounds.max) {
				context.addIssue({
					code: 'custom',
					path: ['saleDate'],
					message: `Elegir una fecha de venta entre el ${formatDate(saleBounds.min)} y hoy.`
				});
				return;
			}
			if (paymentMode === 'full_payment') return;
			const { min, max } = _firstDueDateBounds(sold);
			if (!z.iso.date().safeParse(firstDueDate).success) {
				context.addIssue({
					code: 'custom',
					path: ['firstDueDate'],
					message: 'Ingresar un primer vencimiento válido.'
				});
				return;
			}
			const dueDate = firstDueDate!;
			if (dueDate < min || dueDate > max)
				context.addIssue({
					code: 'custom',
					path: ['firstDueDate'],
					message: `Elegir una fecha entre el ${formatDate(min)} y el ${formatDate(max)}.`
				});
		});
};

type Campaign = NonNullable<Awaited<ReturnType<typeof getCampaignById>>['data']>;

/**
 * The bonds a query finds, each with the name of the collector who has it (null when the role
 * cannot read it). Shared by the `lookup` action and by the load, which runs it for `?bond=` so a
 * link from a bond's record arrives with the bond already found. Null means the read failed.
 */
async function lookupBonds(locals: App.Locals, campaign: Campaign, query: string) {
	// A campaign number ("0068" or "68") searches base/associated numbers; anything else is a code.
	let number: number | null;
	try {
		number = parseCampaignNumber(query, campaignNumberingConfig(campaign));
	} catch {
		number = null;
	}
	const result = await findBondsForSale(
		locals.supabase,
		campaign.id,
		number !== null ? { number } : { code: query.slice(0, 200) }
	);
	if (result.error) return { found: null, message: 'No se pudieron buscar los bonos.' };
	const collectors = await getCollectorsByIds(
		locals.supabase,
		result.data.flatMap((bond) => (bond.collectorId ? [bond.collectorId] : []))
	);
	if (collectors.error) return { found: null, message: 'No se pudieron cargar los cobradores.' };
	return {
		found: result.data.map((bond) => ({
			...bond,
			collectorName: bond.collectorId
				? (collectors.data?.get(bond.collectorId)?.displayName ?? null)
				: null
		})),
		message: null
	};
}

export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (permissionsUnavailable(locals.permissions))
		error(500, { message: 'No se pudieron cargar los permisos.' });
	requireCampaignViewer(locals, url);
	requirePermissionIn(locals.permissions, 'sale.create');
	const [campaign, buyers] = await Promise.all([
		getCampaignById(locals.supabase, params.id),
		listBuyers(locals.supabase, { search: url.searchParams.get('buyer') ?? '', pageSize: 30 })
	]);
	if (campaign.error || buyers.error)
		error(500, { message: 'No se pudo cargar el registro de la venta.' });
	if (!campaign.data) error(404, { message: 'Campaña no encontrada.' });
	// `?bond=0057`: reached from a bond's record (or a bookmark) with the bond to sell. A failed
	// lookup here is not fatal: the page opens with the search field, as without the parameter.
	const bondQuery = (url.searchParams.get('bond') ?? '').trim();
	const prefound = bondQuery ? await lookupBonds(locals, campaign.data, bondQuery) : null;
	return {
		campaign: campaign.data,
		bondQuery,
		found: prefound?.found ?? null,
		buyers: buyers.data?.items ?? [],
		buyerSearch: url.searchParams.get('buyer') ?? '',
		buyerTotal: buyers.data?.total ?? 0,
		canCreateBuyer: hasPermissionIn(locals.permissions, 'buyer.manage'),
		today: argentinaToday(),
		saleDateBounds: _saleDateBounds(campaign.data.startsAt),
		firstDueDateBounds: _firstDueDateBounds()
	};
};

export const actions: Actions = {
	lookup: async ({ request, locals, params, url }) => {
		if (permissionsUnavailable(locals.permissions))
			return fail(500, {
				form: 'lookup',
				errors: {},
				message: 'No se pudieron cargar los permisos.'
			});
		requireCampaignViewer(locals, url);
		requirePermissionIn(locals.permissions, 'sale.create');
		const query = field(await request.formData(), 'query');
		if (!query)
			return fail(400, {
				form: 'lookup',
				errors: { query: ['Ingresar un número o código de bono.'] }
			});
		const campaign = await getCampaignById(locals.supabase, params.id);
		if (campaign.error || !campaign.data)
			return fail(campaign.error ? 500 : 404, {
				form: 'lookup',
				errors: {},
				message: campaign.error ? 'No se pudieron buscar los bonos.' : 'Campaña no encontrada.'
			});
		const looked = await lookupBonds(locals, campaign.data, query);
		if (!looked.found)
			return fail(500, { form: 'lookup', errors: {}, message: looked.message ?? '' });
		return { form: 'lookup', success: true, found: looked.found, query, errors: {} };
	},
	createBuyer: async ({ request, locals, url }) => {
		if (permissionsUnavailable(locals.permissions))
			return fail(500, {
				form: 'buyer',
				errors: {},
				message: 'No se pudieron cargar los permisos.'
			});
		requireCampaignViewer(locals, url);
		if (!hasPermissionIn(locals.permissions, 'buyer.manage'))
			return fail(403, {
				form: 'buyer',
				errors: {},
				message: 'No hay permiso para esta acción.'
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
			return {
				form: 'buyer',
				success: true,
				buyerId,
				// The new buyer may not be among the listed buyers: the page adds it to the options.
				buyerName: buyerDisplayName(parsed.data),
				message: 'Comprador creado.',
				errors: {}
			};
		} catch (err) {
			const failure = partyFailure(err, values);
			return fail(failure.status, { ...failure.data, form: 'buyer' });
		}
	},
	register: async ({ request, locals, params, url }) => {
		if (permissionsUnavailable(locals.permissions))
			return fail(500, {
				form: 'sale',
				errors: {},
				message: 'No se pudieron cargar los permisos.'
			});
		requireCampaignViewer(locals, url);
		if (!hasPermissionIn(locals.permissions, 'sale.create'))
			return fail(403, {
				form: 'sale',
				errors: {},
				message: 'No hay permiso para esta acción.'
			});
		const form = await request.formData();
		const values = {
			bondId: field(form, 'bondId'),
			buyerId: field(form, 'buyerId'),
			paymentMode: field(form, 'paymentMode'),
			firstDueDate: field(form, 'firstDueDate'),
			saleDate: field(form, 'saleDate')
		};
		const loaded = await getCampaignById(locals.supabase, params.id);
		const parsed = saleFormSchema(params.id, loaded.data?.startsAt ?? null).safeParse({
			campaignId: params.id,
			...values
		});
		const errors: Record<string, string[]> = {};
		if (!parsed.success)
			for (const issue of parsed.error.issues) {
				const name = String(issue.path.at(-1));
				if (name !== 'campaignId') (errors[name] ??= []).push(issue.message);
			}
		if (!uuid(values.bondId)) errors.bondId = ['Elegir un bono entregado.'];
		if (!uuid(values.buyerId)) errors.buyerId = ['Elegir un comprador.'];
		if (!PAYMENT_MODES.includes(values.paymentMode as PaymentMode))
			errors.paymentMode = ['Elegir una modalidad de pago.'];
		if (Object.keys(errors).length)
			return fail(400, {
				form: 'sale',
				values,
				errors,
				message: 'Revisar los campos marcados.'
			});
		const campaign = loaded;
		if (campaign.error)
			return fail(500, {
				form: 'sale',
				values,
				errors: {},
				message: 'No se pudo cargar la campaña.'
			});
		if (!campaign.data)
			return fail(404, { form: 'sale', values, errors: {}, message: 'Campaña no encontrada.' });
		const [buyer, bond] = await Promise.all([
			getBuyer(locals.supabase, values.buyerId),
			findBondsForSale(locals.supabase, params.id, { id: values.bondId })
		]);
		if (buyer.error || bond.error)
			return fail(500, {
				form: 'sale',
				values,
				errors: {},
				message: 'No se pudo validar la venta.'
			});
		if (!buyer.data)
			return fail(404, {
				form: 'sale',
				values,
				errors: { buyerId: ['Comprador no encontrado.'] },
				message: 'Comprador no encontrado.'
			});
		// The server-side RPC remains authoritative; this prevents a hand-crafted form from showing
		// a misleading collector confirmation before it reaches the database.
		const candidate = bond.data.find((item) => item.id === values.bondId);
		if (!candidate?.sellable)
			return fail(409, {
				form: 'sale',
				values,
				errors: {
					bondId: [
						candidate?.reason ?? 'This bond is not delivered to a collector and cannot be sold.'
					]
				},
				message: 'El bono no está disponible para la venta.'
			});
		let saleId: string;
		try {
			saleId = await registerSale(
				locals.supabase,
				{
					campaignId: params.id,
					...values,
					paymentMode: values.paymentMode as PaymentMode,
					firstDueDate: values.paymentMode === 'full_payment' ? null : values.firstDueDate,
					// Today (or empty) stays null: the database stamps the real instant.
					saleDate: values.saleDate && values.saleDate !== argentinaToday() ? values.saleDate : null
				},
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

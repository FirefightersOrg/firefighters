import type { PageServerLoad } from './$types';
import { hasPermissionIn } from '$lib/server/auth/permissions';
import { listMyDueInstallments, listMySaleReserved } from '$lib/server/repositories/portal';
import {
	loadFailed,
	pageParam,
	pagination,
	requireSalesViewer,
	requireUuid
} from '$lib/server/portal/route';
import { COLLECTOR_NOTE_MAX } from '$lib/server/services/collector-payments';
import { buenosAiresToday } from '$lib/portal/labels';

/**
 * «Por cobrar»: the installments that are overdue or due this week, and what is needed to send a
 * collection from the list (UX plan PR 10). A collection is sent to the sale's own `registrar`
 * action, with the same fields as the sale page: this load only adds what that form needs (the
 * amount already sent and not processed, today, the note's limit and a request key).
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	const collector = await requireSalesViewer(locals, url);
	const campaignId = requireUuid(params.campaignId, 'Campaña no encontrada.');
	const collect = {
		today: buenosAiresToday(),
		noteMax: COLLECTOR_NOTE_MAX,
		/** One key per page load: a double tap reuses it, so the database answers with the same payment. */
		requestKey: crypto.randomUUID()
	};
	if (!collector)
		return {
			collector,
			due: [],
			pagination: { page: 1, pageCount: 1 },
			reserved: {} as Record<string, string>,
			canRegister: false,
			...collect
		};
	const result = await listMyDueInstallments(locals.supabase, pageParam(url), campaignId);
	if (result.error) loadFailed(locals, 'las cuotas por cobrar', result.error);

	// What the collector already sent and nobody processed, per installment: such an installment is
	// shown as «Enviado» and only what is left can be sent. One read per sale of the page.
	const saleIds = [...new Set(result.data.items.map((item) => item.saleId))];
	const reservedBySale = await Promise.all(
		saleIds.map((saleId) => listMySaleReserved(locals.supabase, saleId))
	);
	const failed = reservedBySale.find((read) => read.error);
	if (failed?.error) loadFailed(locals, 'los cobros enviados', failed.error);

	return {
		collector,
		due: result.data.items,
		pagination: pagination(result.data),
		/** Amount already sent and waiting to be processed, per installment id. */
		reserved: Object.assign({}, ...reservedBySale.map((read) => read.data ?? {})) as Record<
			string,
			string
		>,
		/** Only an active collector registers collections. */
		canRegister:
			hasPermissionIn(locals.permissions, 'payment.create_own') && collector.status === 'active',
		...collect
	};
};

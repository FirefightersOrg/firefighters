import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import {
	getMySale,
	listMySaleInstallments,
	listMySalePayments
} from '$lib/server/repositories/portal';
import { loadFailed, requireSalesViewer, requireUuid } from '$lib/server/portal/route';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const collector = await requireSalesViewer(locals, url);
	if (!collector) error(404, { message: 'Venta no encontrada.' });
	const saleId = requireUuid(params.saleId, 'Venta no encontrada.');
	const sale = await getMySale(locals.supabase, saleId);
	if (sale.error) loadFailed(locals, 'la venta', sale.error);
	// Someone else's sale (or none) answers exactly like a missing one.
	if (!sale.data) error(404, { message: 'Venta no encontrada.' });
	const [installments, payments] = await Promise.all([
		listMySaleInstallments(locals.supabase, saleId),
		listMySalePayments(locals.supabase, saleId)
	]);
	if (installments.error) loadFailed(locals, 'las cuotas', installments.error);
	if (payments.error) loadFailed(locals, 'los pagos', payments.error);
	return { collector, sale: sale.data, installments: installments.data, payments: payments.data };
};

import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	getMySale,
	listMySaleInstallments,
	listMySalePayments,
	listMySaleReserved,
	listMySaleSubmissions
} from '$lib/server/repositories/portal';
import { loadFailed, requireSalesViewer, requireUuid } from '$lib/server/portal/route';
import { requireOwnCollector } from '$lib/server/auth/own-collector';
import { hasPermissionIn } from '$lib/server/auth/permissions';
import {
	COLLECTOR_NOTE_MAX,
	submitCollectorPayment
} from '$lib/server/services/collector-payments';
import { SettlementServiceError } from '$lib/server/services/settlements';
import { centsToDecimalString, parseMoneyInput } from '$lib/domain/money';
import { PAYMENT_METHODS } from '$lib/domain/payments';
import { buenosAiresToday } from '$lib/portal/labels';
import { GENERIC_ERROR_MESSAGE } from '$lib/copy';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const collector = await requireSalesViewer(locals, url);
	if (!collector) error(404, { message: 'Venta no encontrada.' });
	const campaignId = requireUuid(params.campaignId, 'Campaña no encontrada.');
	const saleId = requireUuid(params.saleId, 'Venta no encontrada.');
	const sale = await getMySale(locals.supabase, saleId);
	if (sale.error) loadFailed(locals, 'la venta', sale.error);
	// Someone else's sale (or none) answers exactly like a missing one.
	if (!sale.data || sale.data.campaignId !== campaignId)
		error(404, { message: 'Venta no encontrada.' });
	const [installments, payments, submissions, reserved] = await Promise.all([
		listMySaleInstallments(locals.supabase, saleId),
		listMySalePayments(locals.supabase, saleId),
		listMySaleSubmissions(locals.supabase, saleId),
		listMySaleReserved(locals.supabase, saleId)
	]);
	if (installments.error) loadFailed(locals, 'las cuotas', installments.error);
	if (payments.error) loadFailed(locals, 'los pagos', payments.error);
	if (submissions.error) loadFailed(locals, 'los cobros enviados', submissions.error);
	if (reserved.error) loadFailed(locals, 'los cobros enviados', reserved.error);
	const submissionIds = new Set((submissions.data ?? []).map((x) => x.id));
	return {
		collector,
		sale: sale.data,
		installments: installments.data,
		// Collections the collector sent are listed (with their state) under "Cobros enviados", not twice.
		payments: (payments.data ?? []).filter((p) => !submissionIds.has(p.id)),
		submissions: submissions.data,
		/** Balance already covered by unconfirmed drafts, per installment id. */
		reserved: reserved.data,
		/** Only an active collector registers collections on an active sale. */
		canRegister:
			hasPermissionIn(locals.permissions, 'payment.create_own') &&
			collector.status === 'active' &&
			sale.data.saleStatus === 'active',
		today: buenosAiresToday(),
		/** One key per page load: a double click reuses it, so the database answers with the same payment. */
		requestKey: crypto.randomUUID(),
		noteMax: COLLECTOR_NOTE_MAX,
		submitted: url.searchParams.get('enviado') === '1'
	};
};

const field = (f: FormData, name: string) => String(f.get(name) ?? '').trim();

export const actions: Actions = {
	/** "Registrar cobro": the collector comes from the session, never from the form. */
	registrar: async ({ request, locals, params, url }) => {
		const collector = await requireOwnCollector(
			locals,
			url.pathname + url.search,
			'payment.create_own'
		);
		const saleId = requireUuid(params.saleId, 'Venta no encontrada.');
		const f = await request.formData();
		const values = {
			installmentId: field(f, 'installmentId'),
			amount: field(f, 'amount'),
			paymentMethod: field(f, 'paymentMethod'),
			paymentDate: field(f, 'paymentDate'),
			note: field(f, 'note')
		};
		const requestKey = /^[0-9a-f-]{36}$/i.test(field(f, 'requestKey'))
			? field(f, 'requestKey')
			: null;
		const failure = (status: number, message: string, errors: Record<string, string[]> = {}) =>
			fail(status, {
				form: 'registrar',
				installmentId: values.installmentId,
				values,
				errors,
				message
			});
		if (!collector || collector.status !== 'active')
			return failure(403, 'Tu cuenta de cobrador no está activa.');
		const errors: Record<string, string[]> = {};
		const cents = parseMoneyInput(values.amount);
		if (cents === null || cents <= 0) errors.amount = ['Ingresar un importe mayor que cero.'];
		if (!(PAYMENT_METHODS as readonly string[]).includes(values.paymentMethod))
			errors.paymentMethod = ['Elegir efectivo o transferencia.'];
		const today = buenosAiresToday();
		if (!/^\d{4}-\d{2}-\d{2}$/.test(values.paymentDate))
			errors.paymentDate = ['Ingresar la fecha del cobro.'];
		else if (values.paymentDate > today)
			errors.paymentDate = ['La fecha del cobro no puede ser futura.'];
		if ([...values.note].length > COLLECTOR_NOTE_MAX)
			errors.note = [`La nota admite hasta ${COLLECTOR_NOTE_MAX} caracteres.`];
		if (Object.keys(errors).length) return failure(400, 'Revisar los campos marcados.', errors);

		try {
			await submitCollectorPayment(
				locals.supabase,
				{
					saleId,
					installmentId: values.installmentId,
					amount: centsToDecimalString(cents!),
					paymentMethod: values.paymentMethod as 'cash' | 'transfer',
					paymentDate: values.paymentDate,
					note: values.note || undefined
				},
				{ requestId: requestKey ?? locals.requestId, permissions: locals.permissions ?? null }
			);
		} catch (e) {
			const err = e instanceof SettlementServiceError ? e : null;
			return failure(err?.status ?? 500, err?.message ?? GENERIC_ERROR_MESSAGE);
		}
		// `redirect` throws: keep it outside the try block.
		redirect(303, `/portal/${params.campaignId}/ventas/${saleId}?enviado=1`);
	}
};

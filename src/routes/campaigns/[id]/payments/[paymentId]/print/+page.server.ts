import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { PageServerLoad } from './$types';
import { requirePermissionIn } from '$lib/server/auth/permissions';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { getDocumentActorName } from '$lib/server/repositories/document-actors';
import { getPaymentCertificate } from '$lib/server/repositories/printable-payments';
import { buildPrintablePaymentCertificate } from '$lib/server/documents/payment-certificate';
const uuid = (v: string) => z.guid().safeParse(v).success;
export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireCampaignViewer(locals, url);
	requirePermissionIn(locals.permissions, 'payment.view');
	if (!uuid(params.id) || !uuid(params.paymentId)) error(404, { message: 'Payment not found.' });
	const [campaign, found, actor] = await Promise.all([
		getCampaignById(locals.supabase, params.id),
		getPaymentCertificate(locals.supabase, params.id, params.paymentId),
		getDocumentActorName(locals.supabase, 'payment', params.paymentId)
	]);
	if (campaign.error || found.error || actor.error) {
		console.error('[payments] print load failed', {
			requestId: locals.requestId,
			paymentId: params.paymentId,
			error: campaign.error ?? found.error ?? actor.error
		});
		error(500, { message: 'Could not load the payment.' });
	}
	if (!campaign.data) error(404, { message: 'Campaign not found.' });
	// SAN-111: confirmed payments, and annulled/adjusted ones that were confirmed first (they carry a
	// legend). A pending payment removed from an open settlement was never valid: no certificate.
	if (
		!found.data ||
		!['confirmed', 'annulled', 'adjusted'].includes(found.data.status) ||
		(found.data.status !== 'confirmed' && !found.data.payment.legend)
	)
		error(404, { message: 'El comprobante no está disponible para este pago.' });
	const payment = { ...found.data.payment, registeredBy: actor.data ?? '—' };
	return { document: buildPrintablePaymentCertificate(campaign.data, payment) };
};

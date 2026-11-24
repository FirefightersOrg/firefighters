import { env } from '$env/dynamic/public';
import { formatDate, formatDateTime, formatMoney, formatPaddedNumber } from '$lib/format';
import { formatCampaignNumber } from '$lib/domain/numbering';
import { campaignNumberingConfig } from '$lib/domain/campaigns';
import type { Campaign } from '$lib/domain/campaigns';
export interface PaymentCertificateSource {
	id: string;
	bond: string;
	buyer: string;
	collector: string;
	installments: string;
	amount: string;
	method: string;
	paymentDate: string;
	createdAt: string;
	registeredBy: string;
	settlementNumber: number | null;
	legend: {
		kind: 'annulled' | 'corrected';
		eventAt: string;
		actor: string;
		reason: string;
		relatedPaymentId: string | null;
		correctionType: string;
	} | null;
}
export interface PrintablePaymentCertificate extends Omit<PaymentCertificateSource, 'legend'> {
	institutionName: string;
	campaign: string;
	amount: string;
	receiptNumber: string;
	legend: {
		label: 'ANULADO — COMPROBANTE SIN VALIDEZ' | 'CORREGIDO — VER REFERENCIA';
		detail: string;
		reference: string | null;
	} | null;
}
/** Receipt numbers are stable: settlement number plus the first eight UUID characters, or PAYMENT-<id> when not settled. */
export function buildPrintablePaymentCertificate(
	campaign: Campaign,
	source: PaymentCertificateSource,
	institutionName = env.PUBLIC_INSTITUTION_NAME || 'Bomberos Voluntarios'
): PrintablePaymentCertificate {
	const shortId = source.id.slice(0, 8).toUpperCase();
	const bond = source.bond
		.split(', ')
		.map((number) =>
			/^\d+$/.test(number)
				? formatCampaignNumber(Number(number), campaignNumberingConfig(campaign))
				: number
		)
		.join(', ');
	const legend =
		source.legend === null
			? null
			: source.legend.kind === 'annulled'
				? {
						label: 'ANULADO — COMPROBANTE SIN VALIDEZ' as const,
						detail: `${formatDateTime(source.legend.eventAt)} — ${source.legend.actor}. Motivo: ${source.legend.reason}`,
						reference: null
					}
				: {
						label: 'CORREGIDO — VER REFERENCIA' as const,
						detail: `${formatDateTime(source.legend.eventAt)} — ${source.legend.actor}. Motivo: ${source.legend.reason}`,
						reference: source.legend.relatedPaymentId
							? `Comprobante relacionado: PAY-${source.legend.relatedPaymentId.slice(0, 8).toUpperCase()}`
							: null
					};
	return {
		...source,
		institutionName,
		campaign: campaign.name,
		bond,
		amount: formatMoney(source.amount, { decimals: 'always' }),
		// SQL date is a calendar day: formatDate does not shift zones or invent a time.
		paymentDate: formatDate(source.paymentDate),
		createdAt: formatDateTime(source.createdAt),
		legend,
		receiptNumber: source.settlementNumber
			? `SET-${formatPaddedNumber(source.settlementNumber, 4)}-${shortId}`
			: `PAY-${shortId}`
	};
}

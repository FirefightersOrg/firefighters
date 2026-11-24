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
}
export interface PrintablePaymentCertificate extends PaymentCertificateSource {
	institutionName: string;
	campaign: string;
	amount: string;
	receiptNumber: string;
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
	return {
		...source,
		institutionName,
		campaign: campaign.name,
		bond,
		amount: formatMoney(source.amount, { decimals: 'always' }),
		// SQL date is a calendar day: formatDate does not shift zones or invent a time.
		paymentDate: formatDate(source.paymentDate),
		createdAt: formatDateTime(source.createdAt),
		receiptNumber: source.settlementNumber
			? `SET-${formatPaddedNumber(source.settlementNumber, 4)}-${shortId}`
			: `PAY-${shortId}`
	};
}

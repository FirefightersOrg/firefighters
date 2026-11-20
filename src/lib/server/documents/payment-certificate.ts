import { env } from '$env/dynamic/public';
import { formatMoney } from '$lib/domain/money';
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
const date = (value: string) =>
	new Intl.DateTimeFormat('es-AR', {
		dateStyle: 'short',
		timeStyle: 'short',
		timeZone: 'America/Argentina/Buenos_Aires'
	}).format(new Date(value));
/** SQL date is a calendar day, not a timestamp: do not shift zones or invent a time. */
const paymentDate = (value: string) => {
	const [year, month, day] = value.split('-').map(Number);
	return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short' }).format(
		new Date(year, month - 1, day)
	);
};
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
		amount: formatMoney(source.amount),
		paymentDate: paymentDate(source.paymentDate),
		createdAt: date(source.createdAt),
		receiptNumber: source.settlementNumber
			? `SET-${String(source.settlementNumber).padStart(4, '0')}-${shortId}`
			: `PAY-${shortId}`
	};
}

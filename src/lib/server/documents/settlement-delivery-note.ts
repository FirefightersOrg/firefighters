import { env } from '$env/dynamic/public';
import { formatDateTime, formatMoney, formatPaddedNumber } from '$lib/format';
import { formatCampaignNumber } from '$lib/domain/numbering';
import { campaignNumberingConfig } from '$lib/domain/campaigns';
import type { Campaign } from '$lib/domain/campaigns';

export interface SettlementPrintPayment {
	bond: string;
	buyer: string;
	installments: string;
	method: string;
	amount: string;
}
export interface SettlementPrintSource {
	settlementNumber: number;
	status: 'open' | 'closed' | 'annulled' | 'corrected';
	openedAt: string;
	closedAt: string | null;
	collector: string;
	closedBy: string | null;
	notes: string | null;
	totals: {
		cash: string;
		transfer: string;
		amount: string;
		commission: string;
		commissionPaid: string;
		net: string;
		balance: string;
	};
	payments: SettlementPrintPayment[];
}
export interface PrintableSettlementDeliveryNote extends SettlementPrintSource {
	institutionName: string;
	campaign: string;
	settlementNumberLabel: string;
	openingDate: string;
	closingDate: string;
	preliminary: boolean;
	manualAdjustments: string;
	collectorSignature: string;
	administrationSignature: string;
}
const date = (value: string | null) => formatDateTime(value);
const money = (value: string) => formatMoney(value, { decimals: 'always' });
/** Builds all 20 fields mandated for a settlement delivery note. Open settlements are explicitly preliminary. */
export function buildPrintableSettlementDeliveryNote(
	campaign: Campaign,
	source: SettlementPrintSource,
	institutionName = env.PUBLIC_INSTITUTION_NAME || 'Bomberos Voluntarios'
): PrintableSettlementDeliveryNote {
	return {
		...source,
		institutionName,
		campaign: campaign.name,
		settlementNumberLabel: `Settlement ${formatPaddedNumber(source.settlementNumber, 4)}`,
		openingDate: date(source.openedAt),
		closingDate: date(source.closedAt),
		preliminary: source.status === 'open',
		manualAdjustments: '0 — No manual adjustments have been recorded.',
		collectorSignature: 'Collector signature',
		administrationSignature: 'Administration signature',
		totals: Object.fromEntries(
			Object.entries(source.totals).map(([key, value]) => [key, money(value)])
		) as SettlementPrintSource['totals'],
		payments: source.payments.map((payment) => ({
			...payment,
			bond: payment.bond
				.split(', ')
				.map((number) =>
					/^\d+$/.test(number)
						? formatCampaignNumber(Number(number), campaignNumberingConfig(campaign))
						: number
				)
				.join(', '),
			amount: money(payment.amount)
		}))
	};
}

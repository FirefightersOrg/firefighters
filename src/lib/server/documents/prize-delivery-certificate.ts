import { env } from '$env/dynamic/public';
import { formatDate, formatDateTime } from '$lib/format';
import { campaignNumberingConfig, type Campaign } from '$lib/domain/campaigns';
import { DRAW_TYPE_LABELS, type DrawType } from '$lib/domain/draws';
import { formatCampaignNumber } from '$lib/domain/numbering';
import type { PrizeCertificateSource } from '$lib/server/repositories/printable-prizes';

/** Instant in Buenos Aires, 24 h (docs/copy.md): `31/12/2026, 23:30`. */
const instant = (value: string) => formatDateTime(value);
const calendarDate = (value: string) => formatDate(value);
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
export const frozenBuyerLabel = (snapshot: Record<string, unknown> | null) =>
	text(snapshot?.business_name) ||
	[text(snapshot?.first_name), text(snapshot?.last_name)].filter(Boolean).join(' ') ||
	'—';

export interface PrintablePrizeDeliveryCertificate {
	institutionName: string;
	draw: string;
	drawDate: string;
	prize: string;
	winningNumber: string;
	associatedBond: string;
	buyer: string;
	collector: string;
	rosterStatus: string;
	deliveryDate: string;
	registeredBy: string;
	notes: string;
	recipientSignature: string;
	recipientName: string;
	recipientDocument: string;
}

export function buildPrintablePrizeDeliveryCertificate(
	campaign: Campaign,
	source: PrizeCertificateSource,
	institutionName = env.PUBLIC_INSTITUTION_NAME || 'Bomberos Voluntarios'
): PrintablePrizeDeliveryCertificate {
	return {
		institutionName,
		draw: `${source.drawName} (${DRAW_TYPE_LABELS[source.drawType as DrawType] ?? source.drawType})`,
		drawDate: calendarDate(source.drawDate),
		prize: `#${source.prizePosition} — ${source.prizeName}`,
		winningNumber:
			source.winningNumber === null
				? 'Sin cargar'
				: formatCampaignNumber(source.winningNumber, campaignNumberingConfig(campaign)),
		associatedBond: source.bondLabel || '—',
		buyer: frozenBuyerLabel(source.buyerSnapshot),
		collector: text(source.collectorSnapshot?.display_name) || '—',
		rosterStatus: source.rosterEligible ? 'Habilitado' : 'No habilitado',
		deliveryDate: instant(source.deliveredAt!),
		registeredBy: source.deliveredByName || '—',
		notes: source.deliveryNotes || '—',
		recipientSignature: 'Firma de quien recibe',
		recipientName: 'Aclaración',
		recipientDocument: 'DNI'
	};
}

import { env } from '$env/dynamic/public';
import { formatDateTime } from '$lib/format';
import { campaignNumberingConfig, type Campaign } from '$lib/domain/campaigns';
import { DRAW_TYPE_LABELS, type DrawType } from '$lib/domain/draws';
import { DRAW_INELIGIBILITY_REASON_LABELS } from '$lib/domain/draw-eligibility';
import { formatCampaignNumber } from '$lib/domain/numbering';
import { frozenBuyerLabel } from './prize-delivery-certificate';
import type { PrizeCertificateSource } from '$lib/server/repositories/printable-prizes';

/** Instant in Buenos Aires, 24 h (docs/copy.md): `31/12/2026, 23:30`. */
const instant = (value: string) => formatDateTime(value);
const reason = (source: PrizeCertificateSource) => {
	if (source.winnerStatus === 'no_match') return 'El número no está en el padrón';
	if (source.winnerStatus === 'not_eligible')
		return (
			DRAW_INELIGIBILITY_REASON_LABELS[
				source.ineligibilityReason as keyof typeof DRAW_INELIGIBILITY_REASON_LABELS
			] ??
			source.ineligibilityReason ??
			'No habilitado'
		);
	return source.resolutionNotes || 'Declarado no adjudicado';
};

export interface PrintableUnawardedPrizeCertificate {
	institutionName: string;
	draw: string;
	prize: string;
	winningNumber: string;
	associatedBond: string;
	buyer: string;
	reason: string;
	rosterStatus: string;
	registeredBy: string;
	date: string;
	notes: string;
}

export function buildPrintableUnawardedPrizeCertificate(
	campaign: Campaign,
	source: PrizeCertificateSource,
	institutionName = env.PUBLIC_INSTITUTION_NAME || 'Bomberos Voluntarios'
): PrintableUnawardedPrizeCertificate {
	return {
		institutionName,
		draw: `${source.drawName} (${DRAW_TYPE_LABELS[source.drawType as DrawType] ?? source.drawType})`,
		prize: `#${source.prizePosition} — ${source.prizeName}`,
		winningNumber:
			source.winningNumber === null
				? 'Sin cargar'
				: formatCampaignNumber(source.winningNumber, campaignNumberingConfig(campaign)),
		associatedBond: source.bondLabel || '—',
		buyer: source.buyerSnapshot ? frozenBuyerLabel(source.buyerSnapshot) : '—',
		reason: reason(source),
		rosterStatus:
			source.rosterEligible === null
				? 'No está en el padrón'
				: source.rosterEligible
					? 'Habilitado'
					: `No habilitado${source.ineligibilityReason ? ` — ${reason(source)}` : ''}`,
		registeredBy: source.unawardedByName || '—',
		date: source.unawardedAt ? instant(source.unawardedAt) : '—',
		notes: source.winnerNotes || source.resolutionNotes || '—'
	};
}

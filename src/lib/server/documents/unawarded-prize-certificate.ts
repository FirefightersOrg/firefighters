import { env } from '$env/dynamic/public';
import { campaignNumberingConfig, type Campaign } from '$lib/domain/campaigns';
import { DRAW_TYPE_LABELS, type DrawType } from '$lib/domain/draws';
import { DRAW_INELIGIBILITY_REASON_LABELS } from '$lib/domain/draw-eligibility';
import { formatCampaignNumber } from '$lib/domain/numbering';
import { frozenBuyerLabel } from './prize-delivery-certificate';
import type { PrizeCertificateSource } from '$lib/server/repositories/printable-prizes';

const instant = (value: string) =>
	new Intl.DateTimeFormat('es-AR', {
		dateStyle: 'short',
		timeStyle: 'short',
		timeZone: 'America/Argentina/Buenos_Aires'
	}).format(new Date(value));
const reason = (source: PrizeCertificateSource) => {
	if (source.winnerStatus === 'no_match') return 'Number not in the roster';
	if (source.winnerStatus === 'not_eligible')
		return (
			DRAW_INELIGIBILITY_REASON_LABELS[
				source.ineligibilityReason as keyof typeof DRAW_INELIGIBILITY_REASON_LABELS
			] ??
			source.ineligibilityReason ??
			'Not eligible'
		);
	return source.resolutionNotes || 'Manually left unawarded';
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
				? 'Not loaded'
				: formatCampaignNumber(source.winningNumber, campaignNumberingConfig(campaign)),
		associatedBond: source.bondLabel || source.bondId || '—',
		buyer: source.buyerSnapshot ? frozenBuyerLabel(source.buyerSnapshot) : '—',
		reason: reason(source),
		rosterStatus:
			source.rosterEligible === null
				? 'Not in roster'
				: source.rosterEligible
					? 'Eligible'
					: `Not eligible${source.ineligibilityReason ? ` — ${reason(source)}` : ''}`,
		registeredBy: source.unawardedByName || '—',
		date: source.unawardedAt ? instant(source.unawardedAt) : '—',
		notes: source.winnerNotes || source.resolutionNotes || '—'
	};
}

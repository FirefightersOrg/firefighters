import { error, fail } from '@sveltejs/kit';
import { z } from 'zod';
import type { Campaign } from '$lib/domain/campaigns';
import { campaignNumberingConfig } from '$lib/domain/campaigns';
import { formatCampaignNumber } from '$lib/domain/numbering';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import type { BondListEntry } from '$lib/server/repositories/bonds';
import { CAMPAIGN_MESSAGES } from '$lib/server/services/campaigns';
import { DeliveryServiceError } from '$lib/server/services/deliveries';

export const isUuid = (value: string) => z.guid().safeParse(value).success;

/** Result of every delivery form action (success or `fail()` data). */
export interface DeliveryFormResult {
	success: boolean;
	message?: string;
	errors: Record<string, string[]>;
	values?: Record<string, string>;
	/** Bonds found by a lookup, to add to the selection. */
	found?: DeliveryBondOption[];
	/** The lookup has more matches than can be selected in one delivery. */
	truncated?: boolean;
}

/** A bond as the delivery screens show it. */
export interface DeliveryBondOption {
	id: string;
	label: string;
	kind: string;
	units: number;
	/** Participating base numbers, sorted: what the screens group into ranges (UX plan PR 16). */
	baseNumbers: number[];
	associatedNumbers: number[];
}

export function deliveryFailure(
	status: number,
	message: string,
	extra: { errors?: Record<string, string[]>; values?: Record<string, string> } = {}
) {
	const data: DeliveryFormResult = {
		success: false,
		message,
		errors: extra.errors ?? {},
		values: extra.values
	};
	return fail(status, data);
}

/** Maps a `DeliveryServiceError` to a `fail()` (field error when it has one); rethrows others. */
export function deliveryServiceFailure(err: unknown, values?: Record<string, string>) {
	if (!(err instanceof DeliveryServiceError)) throw err;
	return deliveryFailure(err.status, err.message, {
		errors: err.field ? { [err.field]: [err.message] } : {},
		values
	});
}

/** The campaign of the route (404 for a malformed or unknown id, 500 on failure). */
export async function loadDeliveryCampaign(locals: App.Locals, id: string): Promise<Campaign> {
	if (!isUuid(id)) error(404, { message: CAMPAIGN_MESSAGES.notFound });
	const result = await getCampaignById(locals.supabase, id);
	if (result.error) {
		console.error('[deliveries] campaign load failed', {
			requestId: locals.requestId,
			error: result.error
		});
		error(500, { message: 'No se pudo cargar la campaña. Volver a intentar.' });
	}
	if (!result.data) error(404, { message: CAMPAIGN_MESSAGES.notFound });
	return result.data;
}

/** "0068 / 4939" for a simple bond, "Pata 0100, 0101" for a pata. */
export function bondOption(bond: BondListEntry, campaign: Campaign): DeliveryBondOption {
	const config = campaignNumberingConfig(campaign);
	const fmt = (n: number) => formatCampaignNumber(n, config);
	const label =
		bond.kind === 'simple'
			? `${bond.baseNumbers.map(fmt).join(', ')} / ${bond.associatedNumbers.map(fmt).join(', ')}`
			: `Pata ${bond.baseNumbers.map(fmt).join(', ')}`;
	return {
		id: bond.id,
		label,
		kind: bond.kind,
		units: bond.commercialUnitCount,
		baseNumbers: bond.baseNumbers,
		associatedNumbers: bond.associatedNumbers
	};
}

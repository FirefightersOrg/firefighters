import { z } from 'zod';
import { BOND_COMMERCIAL_STATUS_LABELS, bondTotalValueCents, BondError } from '$lib/domain/bonds';
import { centsToDecimalString } from '$lib/domain/money';
import {
	calculateAssociatedNumber,
	formatCampaignNumber,
	type CampaignNumberingConfig
} from '$lib/domain/numbering';
import type { GroupableBond, GroupingMember } from '$lib/server/repositories/bonds';

/**
 * Manual grouping helpers for `/campaigns/[id]/bonds/pata/new`: which picked bonds can join a
 * pata (and why not), and the preview of the pata they make. The database
 * (`bond_group_into_pata`) checks the same rules again under lock and is the authority.
 */

/** Query parameter holding the picked bonds (repeated), so the selection survives a reload. */
export const GROUPING_SELECTED_PARAM = 'selected';
/** Query parameter of the search by base number. */
export const GROUPING_SEARCH_PARAM = 'q';
/** Most bonds that can be picked at once (keeps the URL reasonable). */
export const GROUPING_MAX_SELECTED = 100;

/** Entry mode of `/campaigns/[id]/bonds/pata/new` (`?mode=`). */
export type PataEntryMode = 'printed' | 'grouping';

const isUuid = (value: string) => z.guid().safeParse(value).success;

/** Distinct valid bond ids, in the given order, at most {@link GROUPING_MAX_SELECTED}. */
export function selectedBondIds(values: readonly string[]): string[] {
	const ids = values
		.flatMap((value) => value.split(','))
		.map((value) => value.trim().toLowerCase())
		.filter(isUuid);
	return [...new Set(ids)].slice(0, GROUPING_MAX_SELECTED);
}

/** A picked bond as the grouping form shows it. */
export interface GroupingMemberView {
	id: string;
	/** Padded like the campaign shows it; null when the bond has no live base number. */
	baseFormatted: string | null;
	associatedFormatted: string | null;
	internalCode: string | null;
	/** Why it cannot join the pata; null when it can. */
	problem: string | null;
	/** The manual pata it already belongs to, to link to it. */
	pataId: string | null;
}

/** Why `member` cannot join a manual pata of `campaignId`, or null when it can. */
export function groupingProblem(member: GroupingMember | undefined, campaignId: string) {
	if (!member) return 'No se encontró el bono.';
	if (member.campaignId !== campaignId) return 'Pertenece a otra campaña.';
	if (member.kind !== 'simple') return 'Es una pata: solo se pueden agrupar bonos simples.';
	if (member.commercialStatus !== 'available') {
		const status = BOND_COMMERCIAL_STATUS_LABELS[member.commercialStatus].toLowerCase();
		return `Está ${status}: solo se pueden agrupar bonos disponibles.`;
	}
	if (member.activeGroupPataId) return 'Ya pertenece a una pata. Desagrupar esa pata primero.';
	return null;
}

/**
 * The picked bonds in the order of `ids` (unknown ones included, with their problem), with their
 * numbers formatted with the campaign config.
 */
export function describeGroupingMembers(
	ids: readonly string[],
	members: readonly GroupingMember[],
	campaignId: string,
	config: CampaignNumberingConfig
): GroupingMemberView[] {
	const byId = new Map(members.map((m) => [m.id, m]));
	return ids.map((id) => {
		const member = byId.get(id);
		const base = member?.baseNumber ?? null;
		return {
			id,
			baseFormatted: base === null ? null : formatCampaignNumber(base, config),
			associatedFormatted:
				base === null
					? null
					: formatCampaignNumber(calculateAssociatedNumber(base, config), config),
			internalCode: member?.internalCode ?? null,
			problem: groupingProblem(member, campaignId),
			pataId: member?.activeGroupPataId ?? null
		};
	});
}

/** Error line for a picked bond that cannot be grouped: "Bono 0068: Está vendido: ...". */
export function groupingProblemMessage(view: GroupingMemberView): string {
	return `${view.baseFormatted ? `Bono ${view.baseFormatted}` : 'Un bono seleccionado'}: ${view.problem}`;
}

/** N and `simple_bond_value * N` of the pata the picked bonds would make (null total when N = 0). */
export function groupingTotals(count: number, simpleBondValue: string) {
	let totalValue: string | null = null;
	if (count > 0) {
		try {
			totalValue = centsToDecimalString(bondTotalValueCents(simpleBondValue, count));
		} catch (err) {
			if (!(err instanceof BondError)) throw err;
		}
	}
	return { unitCount: count, totalValue };
}

/** A bond found by the grouping search, as the page shows it. */
export interface GroupableBondView {
	id: string;
	baseFormatted: string;
	associatedFormatted: string;
	internalCode: string | null;
}

export function describeGroupableBond(
	bond: GroupableBond,
	config: CampaignNumberingConfig
): GroupableBondView {
	return {
		id: bond.id,
		baseFormatted: formatCampaignNumber(bond.baseNumber, config),
		associatedFormatted: formatCampaignNumber(
			calculateAssociatedNumber(bond.baseNumber, config),
			config
		),
		internalCode: bond.internalCode
	};
}

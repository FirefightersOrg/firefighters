import { z } from 'zod';
import { statusWord } from '$lib/domain/status-word';
import { bondTotalValueCents, BondError } from '$lib/domain/bonds';
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
	if (!member) return 'Bond not found.';
	if (member.campaignId !== campaignId) return 'It belongs to another campaign.';
	if (member.kind !== 'simple') return 'It is a pata: only simple bonds can be grouped.';
	if (member.commercialStatus !== 'available') {
		const status = statusWord(member.commercialStatus);
		return `It is ${status}: only available bonds can be grouped.`;
	}
	if (member.activeGroupPataId) return 'It already belongs to a pata. Ungroup that pata first.';
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

/** Error line for a picked bond that cannot be grouped: "Bond 0068: It is sold: ...". */
export function groupingProblemMessage(view: GroupingMemberView): string {
	return `${view.baseFormatted ? `Bond ${view.baseFormatted}` : 'A selected bond'}: ${view.problem}`;
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

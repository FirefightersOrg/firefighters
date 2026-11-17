import type {
	BondRecord,
	BondRecordMember,
	BondRecordNumber
} from '$lib/components/bonds/record/types';
import { campaignNumberingConfig, canLoadBonds, type Campaign } from '$lib/domain/campaigns';
import { formatCampaignNumber } from '$lib/domain/numbering';
import { hasPermissionIn } from '$lib/server/auth/permissions';
import type { BondDetail, BondGroupHistoryEntry, BondNumber } from '$lib/server/repositories/bonds';
import { campaignLockedMessage } from './route-helpers';

/** Builds the bond record page's view model (pure: everything is passed in). */

const TYPE_LABELS = {
	simple: 'Simple bond',
	printed: 'Printed pata',
	manual_grouping: 'Manually grouped pata'
} as const;

export function bondTypeLabel(bond: Pick<BondDetail, 'kind' | 'origin'>): string {
	return bond.kind === 'simple' ? TYPE_LABELS.simple : TYPE_LABELS[bond.origin];
}

/** The live base numbers of `bondIds` (in that order), padded: `"0010 + 0011"`. */
export function pataLabel(
	memberIds: readonly string[],
	numbers: readonly BondNumber[],
	campaign: Campaign
): string {
	const config = campaignNumberingConfig(campaign);
	const bases = memberIds.flatMap((id) =>
		numbers
			.filter((n) => n.bondId === id && n.numberKind === 'base')
			.map((n) => formatCampaignNumber(n.numberValue, config))
	);
	return bases.sort().join(' + ');
}

export interface BondRecordInput {
	campaign: Campaign;
	bond: BondDetail;
	/** Manual pata: every membership (active and ungrouped). */
	memberships: readonly BondGroupHistoryEntry[];
	/** Manual pata: the numbers of its members (all of them, history included). */
	memberNumbers: readonly BondNumber[];
	/** Member of a manual pata: that pata's active member ids and their numbers, for its label. */
	parentPata: { memberIds: readonly string[]; numbers: readonly BondNumber[] } | null;
	permissions: readonly string[];
}

export function buildBondRecord(input: BondRecordInput): BondRecord {
	const { campaign, bond, memberships, memberNumbers, parentPata, permissions } = input;
	const config = campaignNumberingConfig(campaign);
	const format = (value: number) => formatCampaignNumber(value, config);
	const isManualPata = bond.origin === 'manual_grouping';

	// Members are shown by base number (they are grouped at the same instant).
	const baseOf = (id: string) =>
		memberNumbers.find((n) => n.bondId === id && n.numberKind === 'base')?.numberValue ??
		Number.MAX_SAFE_INTEGER;
	const sortedMemberships = [...memberships].sort(
		(a, b) =>
			Number(!!a.ungroupedAt) - Number(!!b.ungroupedAt) ||
			(a.ungroupedAt ?? '').localeCompare(b.ungroupedAt ?? '') ||
			baseOf(a.memberBondId) - baseOf(b.memberBondId)
	);

	// A manual pata owns no numbers: show its active members' numbers.
	const activeMemberIds = sortedMemberships
		.filter((m) => !m.ungroupedAt)
		.map((m) => m.memberBondId);
	const numbers: BondRecordNumber[] = isManualPata
		? activeMemberIds.flatMap((id) =>
				memberNumbers
					.filter((n) => n.bondId === id && n.releasedAt === null)
					.map((n) => ({
						formatted: format(n.numberValue),
						kind: n.numberKind,
						released: false,
						ownerBondId: id
					}))
			)
		: bond.numbers.map((n) => ({
				formatted: format(n.numberValue),
				kind: n.numberKind,
				released: n.releasedAt !== null,
				ownerBondId: bond.id
			}));

	const memberNumber = (id: string, kind: 'base' | 'associated') => {
		const found = memberNumbers.find((n) => n.bondId === id && n.numberKind === kind);
		return found ? format(found.numberValue) : null;
	};
	const members: BondRecordMember[] = sortedMemberships.map((m) => ({
		bondId: m.memberBondId,
		baseFormatted: memberNumber(m.memberBondId, 'base'),
		associatedFormatted: memberNumber(m.memberBondId, 'associated'),
		groupedAt: m.groupedAt,
		ungroupedAt: m.ungroupedAt,
		reason: m.reason
	}));

	const memberOf = bond.activeGroup
		? {
				pataId: bond.activeGroup.pataBondId,
				label: parentPata ? pataLabel(parentPata.memberIds, parentPata.numbers, campaign) : ''
			}
		: null;

	const open = canLoadBonds(campaign.status);
	const available = bond.commercialStatus === 'available';
	const couldUngroup = isManualPata && available && hasPermissionIn(permissions, 'bond.create');
	const couldAnnul =
		!isManualPata && available && !bond.activeGroup && hasPermissionIn(permissions, 'bond.annul');

	return {
		general: {
			id: bond.id,
			kind: bond.kind,
			origin: bond.origin,
			typeLabel: bondTypeLabel(bond),
			commercialStatus: bond.commercialStatus,
			financialStatus: bond.financialStatusSnapshot,
			unitCount: bond.commercialUnitCount,
			totalValue: bond.totalValue,
			internalCode: bond.internalCode,
			barcode: bond.barcode,
			createdAt: bond.createdAt,
			annulledAt: bond.annulledAt,
			annulReason: bond.annulReason,
			annulledFromStatus: bond.annulledFromStatus
		},
		numbers,
		group: { members, memberOf },
		actions: {
			ungroup: couldUngroup && open,
			annul: couldAnnul && open,
			lockedMessage:
				(couldUngroup || couldAnnul) && !open ? campaignLockedMessage(campaign.status) : null
		}
	};
}

import type {
	BondRecord,
	BondRecordAuditEntry,
	BondRecordMember,
	BondRecordNumber,
	BondRecordPastPata
} from '$lib/components/bonds/record/types';
import {
	BARCODE_MODE_LABELS,
	campaignNumberingConfig,
	canLoadBonds,
	type Campaign
} from '$lib/domain/campaigns';
import { formatCampaignNumber } from '$lib/domain/numbering';
import { hasPermissionIn } from '$lib/server/auth/permissions';
import type { AuditEntry } from '$lib/server/repositories/audit-log';
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

/** Base numbers padded and joined: `[68, 69]` → `"0068 + 0069"`. */
export function formatPataLabel(baseNumbers: readonly number[], campaign: Campaign): string {
	const config = campaignNumberingConfig(campaign);
	return [...baseNumbers]
		.sort((a, b) => a - b)
		.map((n) => formatCampaignNumber(n, config))
		.join(' + ');
}

export const AUDIT_ACTION_LABELS: Record<string, string> = {
	'bond.create': 'Loaded',
	'bond.group': 'Grouped into a pata',
	'bond.ungroup': 'Pata ungrouped',
	'bond.annul': 'Annulled'
};

/** Pata entries shown on a member's record. */
const PATA_ACTIONS_FOR_MEMBERS = new Set(['bond.group', 'bond.ungroup']);

export interface BondRecordInput {
	campaign: Campaign;
	bond: BondDetail;
	/** Manual pata: every membership (active and ungrouped). */
	memberships: readonly BondGroupHistoryEntry[];
	/** Manual pata: the numbers of its members (all of them, history included). */
	memberNumbers: readonly BondNumber[];
	/** Simple bond: every manual pata it was a member of (active and ungrouped). */
	membershipsAsMember: readonly BondGroupHistoryEntry[];
	/** Base numbers of those patas (`public.bond_list`), by pata id, to name them. */
	pataBaseNumbers: ReadonlyMap<string, readonly number[]>;
	/** Audit entries of the bond and of its patas (null without `audit.view`). */
	audit: { entries: readonly AuditEntry[]; truncated: boolean } | null;
	permissions: readonly string[];
}

/** The bond ids listed in an audit value's `key` (e.g. `members`), if any. */
function idsIn(value: unknown, key: string): string[] {
	if (!value || typeof value !== 'object') return [];
	const list = (value as Record<string, unknown>)[key];
	return Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : [];
}

/** Numbers of an audit snapshot (`[{ number_value, number_kind }]`), padded. */
function numbersIn(value: unknown, key: string, format: (n: number) => string): string[] {
	if (!value || typeof value !== 'object') return [];
	const list = (value as Record<string, unknown>)[key];
	if (!Array.isArray(list)) return [];
	return list.flatMap((item) => {
		const n = (item as { number_value?: unknown } | null)?.number_value;
		return typeof n === 'number' ? [format(n)] : [];
	});
}

const pretty = (value: unknown) =>
	value === null || value === undefined ? null : JSON.stringify(value, null, 2);

export function buildBondRecord(input: BondRecordInput): BondRecord {
	const { campaign, bond, memberships, memberNumbers, permissions } = input;
	const config = campaignNumberingConfig(campaign);
	const format = (value: number) => formatCampaignNumber(value, config);
	const isManualPata = bond.origin === 'manual_grouping';
	const pataLabelOf = (pataId: string) =>
		formatPataLabel(input.pataBaseNumbers.get(pataId) ?? [], campaign);

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
		? { pataId: bond.activeGroup.pataBondId, label: pataLabelOf(bond.activeGroup.pataBondId) }
		: null;
	const pastPatas: BondRecordPastPata[] = input.membershipsAsMember.flatMap((m) =>
		m.ungroupedAt
			? [
					{
						pataId: m.pataBondId,
						label: pataLabelOf(m.pataBondId),
						groupedAt: m.groupedAt,
						ungroupedAt: m.ungroupedAt,
						reason: m.reason
					}
				]
			: []
	);

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
		group: { members, memberOf, pastPatas },
		barcode: {
			barcode: bond.barcode,
			internalCode: bond.internalCode,
			modeLabel: BARCODE_MODE_LABELS[campaign.barcodeMode]
		},
		collector: { id: bond.currentCollectorId },
		buyer: { id: bond.currentBuyerId },
		audit: input.audit
			? {
					allowed: true,
					entries: buildAuditEntries(bond, input.audit.entries, pataLabelOf, format),
					truncated: input.audit.truncated
				}
			: { allowed: false, entries: [], truncated: false },
		actions: {
			ungroup: couldUngroup && open,
			annul: couldAnnul && open,
			lockedMessage:
				(couldUngroup || couldAnnul) && !open ? campaignLockedMessage(campaign.status) : null
		}
	};
}

/**
 * The bond's own entries, plus the grouping / ungrouping entries of manual patas that list it as
 * a member (its pata's history), newest first.
 */
export function buildAuditEntries(
	bond: Pick<BondDetail, 'id'>,
	entries: readonly AuditEntry[],
	pataLabelOf: (pataId: string) => string,
	format: (n: number) => string
): BondRecordAuditEntry[] {
	return entries.flatMap((entry): BondRecordAuditEntry[] => {
		const own = entry.entityType === 'bond' && entry.entityId === bond.id;
		const listsBond =
			idsIn(entry.newValue, 'members').includes(bond.id) ||
			idsIn(entry.oldValue, 'members').includes(bond.id);
		const viaPata =
			!own &&
			entry.entityType === 'bond' &&
			entry.entityId !== null &&
			PATA_ACTIONS_FOR_MEMBERS.has(entry.action) &&
			listsBond;
		if (!own && !viaPata) return [];

		const pata = viaPata ? { pataId: entry.entityId!, label: pataLabelOf(entry.entityId!) } : null;
		let summary: string | null = null;
		if (entry.action === 'bond.create') {
			const loaded = numbersIn(entry.newValue, 'numbers', format);
			summary = loaded.length ? `Numbers ${loaded.join(', ')}` : null;
		} else if (entry.action === 'bond.annul') {
			const released = numbersIn(entry.newValue, 'released_numbers', format);
			summary = released.length ? `Released numbers ${released.join(', ')}` : null;
		} else if (entry.action === 'bond.group') {
			summary = pata
				? `This bond was grouped into pata ${pata.label}`
				: `${idsIn(entry.newValue, 'members').length} bonds grouped`;
		} else if (entry.action === 'bond.ungroup') {
			summary = pata
				? `This bond was freed from pata ${pata.label}`
				: `${idsIn(entry.newValue, 'ungrouped_members').length} bonds freed`;
		}

		return [
			{
				id: entry.id,
				action: entry.action,
				actionLabel: AUDIT_ACTION_LABELS[entry.action] ?? entry.action,
				createdAt: entry.createdAt,
				actorLabel: entry.actorName ?? (entry.actorUserId ? 'A user' : 'System'),
				reason: entry.reason,
				summary,
				viaPata: pata,
				oldValue: pretty(entry.oldValue),
				newValue: pretty(entry.newValue),
				requestId: entry.requestId
			}
		];
	});
}

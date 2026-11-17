/**
 * View model of the bond record page (`/campaigns/[id]/bonds/[bondId]`), built on the server by
 * `buildBondRecord` ($lib/server/bonds/record.ts). One part per section component, so new
 * sections (collector, buyer, sale, installments, payments, ...) can be added independently.
 */
import type {
	BondCommercialStatus,
	BondFinancialStatus,
	BondKind,
	BondNumberKind,
	BondOrigin
} from '$lib/domain/bonds';
import { CAMPAIGN_TIME_ZONE } from '$lib/domain/campaigns';

export interface BondRecordGeneral {
	id: string;
	kind: BondKind;
	origin: BondOrigin;
	/** "Simple bond", "Printed pata" or "Manually grouped pata". */
	typeLabel: string;
	commercialStatus: BondCommercialStatus;
	financialStatus: BondFinancialStatus;
	unitCount: number;
	/** Two-decimal string. */
	totalValue: string;
	internalCode: string | null;
	barcode: string | null;
	createdAt: string;
	annulledAt: string | null;
	annulReason: string | null;
}

export interface BondRecordNumber {
	/** Padded like the campaign shows it. */
	formatted: string;
	kind: BondNumberKind;
	/** Released when the bond was annulled: it no longer counts and can be entered again. */
	released: boolean;
	/** For a manual pata: the member bond that owns the number. */
	ownerBondId: string;
}

/** A member of a manual pata (active or ungrouped). */
export interface BondRecordMember {
	bondId: string;
	baseFormatted: string | null;
	associatedFormatted: string | null;
	groupedAt: string;
	ungroupedAt: string | null;
	/** Ungrouping reason. */
	reason: string | null;
}

export interface BondRecordGroup {
	/** For a manual pata: its members (active first, then the ungrouped ones as history). */
	members: BondRecordMember[];
	/** For a simple bond: the manual pata it is an active member of. */
	memberOf: { pataId: string; label: string } | null;
}

export interface BondRecordActions {
	/** Available manual pata, bond.create, campaign draft/active. */
	ungroup: boolean;
	/** Available simple bond / printed pata not in a pata, bond.annul, campaign draft/active. */
	annul: boolean;
	/** Why the bond cannot be changed now (campaign status), when it otherwise could. */
	lockedMessage: string | null;
}

export interface BondRecord {
	general: BondRecordGeneral;
	numbers: BondRecordNumber[];
	group: BondRecordGroup;
	actions: BondRecordActions;
}

/** "Nov 17, 2026, 10:30 AM" in the campaign time zone; "—" when missing. */
export function formatBondTimestamp(timestamp: string | null): string {
	if (!timestamp) return '—';
	const ms = Date.parse(timestamp);
	if (Number.isNaN(ms)) return '—';
	return new Intl.DateTimeFormat('en-US', {
		dateStyle: 'medium',
		timeStyle: 'short',
		timeZone: CAMPAIGN_TIME_ZONE
	}).format(ms);
}

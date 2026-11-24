/**
 * View model of the bond record page (`/campaigns/[id]/bonds/[bondId]`), built on the server by
 * `buildBondRecord` ($lib/server/bonds/record.ts). One part per section component (the 14
 * sections of docs/screens.md "Bond record"); sections whose data arrives in later phases render
 * an empty state from the bond alone.
 */
import type {
	BondCommercialStatus,
	BondFinancialStatus,
	BondKind,
	BondNumberKind,
	BondOrigin
} from '$lib/domain/bonds';
import { formatDateTime } from '$lib/format';

export interface BondRecordGeneral {
	id: string;
	kind: BondKind;
	origin: BondOrigin;
	/** "Bono simple", "Pata impresa" or "Pata agrupada manualmente". */
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
	/**
	 * Status the bond was annulled from. Only `available` (loaded by mistake) freed its numbers and
	 * codes; an annulled sale keeps them held.
	 */
	annulledFromStatus: BondCommercialStatus | null;
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

/** A manual pata a simple bond was a member of and that was ungrouped. */
export interface BondRecordPastPata {
	pataId: string;
	/** Its base numbers: `"0068 + 0069"`. */
	label: string;
	groupedAt: string;
	ungroupedAt: string;
	reason: string | null;
}

export interface BondRecordGroup {
	/** For a manual pata: its members (active first, then the ungrouped ones as history). */
	members: BondRecordMember[];
	/** For a simple bond: the manual pata it is an active member of. */
	memberOf: { pataId: string; label: string } | null;
	/** For a simple bond: the manual patas it was in before they were ungrouped, oldest first. */
	pastPatas: BondRecordPastPata[];
}

/** Section 3, "Barcode": the bond's codes and how the campaign reads barcodes. */
export interface BondRecordBarcode {
	barcode: string | null;
	internalCode: string | null;
	/** The campaign's barcode mode, e.g. "Barcode is the base number". */
	modeLabel: string;
}

/** Sections 4 and 5: the current collector / buyer (Phase 5 adds their records). */
export interface BondRecordParty {
	/** `bonds.current_collector_id` / `current_buyer_id`; null while not assigned. */
	id: string | null;
}

/** One audit_log row about this bond, ready to show. */
export interface BondRecordAuditEntry {
	id: string;
	action: string;
	/** "Loaded", "Grouped into a pata", "Annulled", ... */
	actionLabel: string;
	createdAt: string;
	/** The actor's name, "Sistema" without an actor, "Un usuario" when their profile is not visible. */
	actorLabel: string;
	reason: string | null;
	/** One line about what changed (numbers loaded or released, members grouped or freed). */
	summary: string | null;
	/** The entry belongs to a manual pata this bond was a member of (grouping / ungrouping). */
	viaPata: { pataId: string; label: string } | null;
	/** Pretty-printed old/new values (null when absent). */
	oldValue: string | null;
	newValue: string | null;
	requestId: string | null;
}

/** Section 13, "Audit": only with `audit.view`. */
export interface BondRecordAudit {
	allowed: boolean;
	entries: BondRecordAuditEntry[];
	/** The entries were capped (only the newest are shown). */
	truncated: boolean;
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
	barcode: BondRecordBarcode;
	collector: BondRecordParty;
	buyer: BondRecordParty;
	audit: BondRecordAudit;
	actions: BondRecordActions;
}

/** The 14 sections of docs/screens.md "Bond record", in order (anchor id and title). */
export const BOND_RECORD_SECTIONS = [
	{ id: 'general', title: 'Datos generales' },
	{ id: 'numbers', title: 'Números participantes' },
	{ id: 'barcode', title: 'Código de barras' },
	{ id: 'collector', title: 'Cobrador actual' },
	{ id: 'custody', title: 'Historial de asignaciones' },
	{ id: 'buyer', title: 'Comprador actual' },
	{ id: 'sale', title: 'Venta' },
	{ id: 'installments', title: 'Cuotas' },
	{ id: 'payments', title: 'Pagos' },
	{ id: 'settlements', title: 'Rendiciones' },
	{ id: 'commissions', title: 'Comisiones' },
	{ id: 'draws', title: 'Sorteos y padrones' },
	{ id: 'prizes', title: 'Premios' },
	{ id: 'audit', title: 'Auditoría' }
] as const;

export type BondRecordSectionId = (typeof BOND_RECORD_SECTIONS)[number]['id'];

/** "17/11/2026, 10:30" in Buenos Aires time (es-AR); "—" when missing. */
export function formatBondTimestamp(timestamp: string | null): string {
	return formatDateTime(timestamp);
}

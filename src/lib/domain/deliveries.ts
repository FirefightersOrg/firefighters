/**
 * Bond delivery to collectors (SAN-53/54): delivery notes and the custody history of each bond.
 * See the migration `20261204000000_bond_delivery.sql` and docs/state-machines.md (Bond).
 */

export const ASSIGNMENT_TYPES = ['delivery', 'return', 'reassignment', 'lost'] as const;
export type AssignmentType = (typeof ASSIGNMENT_TYPES)[number];

export const ASSIGNMENT_STATUSES = ['active', 'returned', 'reassigned', 'lost'] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const DELIVERY_NOTE_REASONS = ['delivery', 'reassignment', 'return'] as const;
export type DeliveryNoteReason = (typeof DELIVERY_NOTE_REASONS)[number];

export const DELIVERY_NOTE_REASON_LABELS: Record<DeliveryNoteReason, string> = {
	delivery: 'Entrega',
	reassignment: 'Reasignación',
	return: 'Devolución'
};

/** At most this many bonds per delivery, reassignment or return (database limit). */
export const DELIVERY_MAX_BONDS = 500;
export const DELIVERY_NOTES_MAX_LENGTH = 2000;
export const LOSS_RESPONSIBLE_MAX_LENGTH = 200;

export interface DeliveryNote {
	id: string;
	campaignId: string;
	noteNumber: number;
	collectorId: string;
	collectorName: string | null;
	status: 'issued' | 'annulled';
	reason: DeliveryNoteReason;
	issuedAt: string;
	createdBy: string;
	createdByName: string | null;
	notes: string | null;
	bondCount: number;
}

export interface BondAssignment {
	id: string;
	bondId: string;
	collectorId: string | null;
	collectorName: string | null;
	assignmentType: AssignmentType;
	status: AssignmentStatus;
	assignedAt: string;
	returnedAt: string | null;
	createdBy: string;
	notes: string | null;
	deliveryNoteId: string | null;
	noteNumber: number | null;
	responsibleParty: string | null;
	lostOn: string | null;
}

/** "Remito 0007" style label (at least 4 digits), like the printed delivery note. */
export function deliveryNoteLabel(noteNumber: number): string {
	return `Remito ${String(noteNumber).padStart(4, '0')}`;
}

/**
 * Whose note it is, as it is said after the number: «Remito 0007 a Jorge Medina» for a delivery or
 * a reassignment (the bonds go to that collector), «Remito 0013 de Lucía Fernández» for a return
 * (they come back from that collector). Empty when the role cannot read the collector: the name is
 * left out, never replaced.
 */
export function deliveryNoteParty(
	reason: DeliveryNoteReason,
	collectorName: string | null | undefined
): string {
	if (!collectorName) return '';
	return `${reason === 'return' ? 'de' : 'a'} ${collectorName}`;
}

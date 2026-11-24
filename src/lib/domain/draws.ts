/** SAN-75 storage contracts; dates remain date-only and snapshots are historical. */
export const DRAW_NAME_MAX = 200;
export const DRAW_REASON_MAX = 1000;
export const DRAW_TYPES = [
	'monthly',
	'extraordinary_full_payment',
	'final',
	'consolation'
] as const;
export type DrawType = (typeof DRAW_TYPES)[number];
export const DRAW_TYPE_LABELS: Record<DrawType, string> = {
	monthly: 'Monthly',
	extraordinary_full_payment: 'Extraordinary full payment',
	final: 'Final',
	consolation: 'Consolation'
};
export const DRAW_STATUSES = [
	'scheduled',
	'roster_generated',
	'roster_frozen',
	'completed',
	'closed',
	'annulled'
] as const;
export type DrawStatus = (typeof DRAW_STATUSES)[number];
export const DRAW_STATUS_LABELS: Record<DrawStatus, string> = {
	scheduled: 'Programado',
	roster_generated: 'Padrón generado',
	roster_frozen: 'Padrón congelado',
	completed: 'Realizado',
	closed: 'Cerrado',
	annulled: 'Anulado'
};
export const DRAW_TRANSITIONS: Record<DrawStatus, readonly DrawStatus[]> = {
	scheduled: ['roster_generated', 'annulled'],
	roster_generated: ['roster_frozen'],
	roster_frozen: ['completed'],
	completed: ['closed'],
	closed: [],
	annulled: []
};
export const canTransitionDraw = (from: DrawStatus, to: DrawStatus) =>
	DRAW_TRANSITIONS[from].includes(to);
export const DRAW_ROSTER_STATUSES = ['generated', 'frozen', 'superseded'] as const;
export type DrawRosterStatus = (typeof DRAW_ROSTER_STATUSES)[number];
export const DRAW_ROSTER_STATUS_LABELS: Record<DrawRosterStatus, string> = {
	generated: 'Generado',
	frozen: 'Congelado',
	superseded: 'Reemplazado'
};
export const DRAW_ROSTER_TRANSITIONS: Record<DrawRosterStatus, readonly DrawRosterStatus[]> = {
	generated: ['frozen', 'superseded'],
	frozen: [],
	superseded: []
};
export const canTransitionDrawRoster = (from: DrawRosterStatus, to: DrawRosterStatus) =>
	DRAW_ROSTER_TRANSITIONS[from].includes(to);
export interface Draw {
	id: string;
	campaignId: string;
	drawType: DrawType;
	name: string;
	drawDate: string;
	paymentCutoffAt: string;
	requiredInstallmentNumber: number | null;
	eligibilityRule: Record<string, unknown>;
	status: DrawStatus;
	createdAt: string;
	createdBy: string;
	updatedAt: string;
	annulledAt: string | null;
	annulledBy: string | null;
	annulReason: string | null;
}
export interface DrawRoster {
	id: string;
	drawId: string;
	status: DrawRosterStatus;
	generatedAt: string;
	generatedBy: string;
	frozenAt: string | null;
	frozenBy: string | null;
	createdAt: string;
	createdBy: string;
	updatedAt: string;
}
export interface DrawRosterEntry {
	id: string;
	drawRosterId: string;
	bondId: string;
	bondNumberId: string;
	numberValue: number;
	buyerSnapshot: Record<string, unknown>;
	collectorSnapshot: Record<string, unknown>;
	eligible: boolean;
	ineligibilityReason: string | null;
	createdAt: string;
	createdBy: string;
	updatedAt: string;
}

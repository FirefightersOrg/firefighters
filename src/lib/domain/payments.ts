/** Payments and collector settlements (SAN-62). Mirrors the database state guards. */
export const PAYMENT_METHODS = ['cash', 'transfer'] as const;
export const SETTLEMENT_NOTES_MAX = 2000;
export const PAYMENT_ANNULMENT_REASON_MAX = 1000; // matches audit_log.reason (SAN-97)
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
	cash: 'Cash',
	transfer: 'Transfer'
};

export const PAYMENT_STATUSES = [
	'draft',
	'pending_in_settlement',
	'confirmed',
	'annulled',
	'adjusted'
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
	draft: 'Borrador',
	pending_in_settlement: 'Pendiente de rendición',
	confirmed: 'Confirmado',
	annulled: 'Anulado',
	adjusted: 'Ajustado'
};
export const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
	draft: ['pending_in_settlement'],
	pending_in_settlement: ['confirmed', 'annulled'],
	confirmed: ['annulled', 'adjusted'],
	annulled: [],
	adjusted: []
};
export const canTransitionPayment = (from: PaymentStatus, to: PaymentStatus) =>
	PAYMENT_TRANSITIONS[from].includes(to);

export const SETTLEMENT_STATUSES = ['open', 'closed', 'annulled', 'corrected'] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];
export const SETTLEMENT_STATUS_LABELS: Record<SettlementStatus, string> = {
	open: 'Abierta',
	closed: 'Cerrada',
	annulled: 'Anulada',
	corrected: 'Corregida'
};
export const SETTLEMENT_TRANSITIONS: Record<SettlementStatus, readonly SettlementStatus[]> = {
	open: ['closed', 'annulled'],
	closed: ['corrected'],
	annulled: [],
	corrected: []
};
export const canTransitionSettlement = (from: SettlementStatus, to: SettlementStatus) =>
	SETTLEMENT_TRANSITIONS[from].includes(to);

export interface Payment {
	id: string;
	campaignId: string;
	saleId: string;
	collectorId: string;
	buyerId: string;
	settlementId: string | null;
	amount: string;
	paymentMethod: PaymentMethod;
	paymentDate: string;
	status: PaymentStatus;
	createdBy: string;
	createdAt: string;
	updatedAt: string;
	annulledBy: string | null;
	annulledAt: string | null;
	annulmentReason: string | null;
}
export interface Settlement {
	id: string;
	campaignId: string;
	settlementNumber: number;
	collectorId: string;
	status: SettlementStatus;
	openedAt: string;
	closedAt: string | null;
	createdBy: string;
	closedBy: string | null;
	totalCash: string;
	totalTransfer: string;
	totalAmount: string;
	commissionAmount: string;
	commissionPaidAmount: string;
	netToFirefighters: string;
	notes: string | null;
	updatedAt: string;
}
export interface PaymentInstallment {
	paymentId: string;
	installmentId: string;
	amountApplied: string;
}

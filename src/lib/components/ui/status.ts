import type { AssignmentStatus } from '$lib/domain/deliveries';
import type { BondCommercialStatus, BondFinancialStatus } from '$lib/domain/bonds';
import type { CampaignStatus } from '$lib/domain/campaigns';
import type { CommissionRuleStatus } from '$lib/domain/commissions';
import type { DrawRosterStatus, DrawStatus } from '$lib/domain/draws';
import type { ImportItemStatus, ImportSessionStatus } from '$lib/domain/imports';
import type { LedgerStatus } from '$lib/domain/ledger';
import type { CollectorStatus } from '$lib/domain/parties';
import type { PaymentStatus, SettlementStatus } from '$lib/domain/payments';
import type { InstallmentStatus, PaymentPlanStatus, SaleStatus } from '$lib/domain/sales';
import type { Tone } from './tones';

/**
 * The one place that maps every domain status to a Badge tone and its Spanish label
 * (docs/copy.md glossary). Every status shows a word, so color is never the only signal.
 * Tone convention: draft/created -> neutral, active/ok -> success, pending/closing -> warning,
 * closed/completed/in progress -> info, annulled/rejected/failed -> danger.
 */
export interface StatusMeta {
	tone: Tone;
	label: string;
}

const s = (tone: Tone, label: string): StatusMeta => ({ tone, label });

// Prize statuses come from the prizes migration (supabase/migrations/*_prizes.sql); their
// domain module is declared here until it joins this branch.
export type PrizeStatus =
	'pending_validation' | 'awarded' | 'pending_delivery' | 'delivered' | 'unawarded' | 'annulled';
export type WinningNumberStatus =
	'pending_review' | 'eligible_winner' | 'not_eligible' | 'no_match';
export type PrizeAwardStatus = 'awarded' | 'delivered' | 'annulled';
export type DeliveryNoteStatus = 'issued' | 'annulled';

/** `rolled_back` and `removed` are display-only states of import sessions and items. */
export type ImportSessionDisplayStatus = ImportSessionStatus | 'rolled_back';
export type ImportItemDisplayStatus = ImportItemStatus | 'removed';

export const STATUS_MAP = {
	campaign: {
		draft: s('neutral', 'Borrador'),
		active: s('success', 'Activa'),
		closing: s('warning', 'En cierre'),
		closed: s('info', 'Cerrada'),
		annulled: s('danger', 'Anulada')
	} satisfies Record<CampaignStatus, StatusMeta>,
	bondCommercial: {
		created: s('neutral', 'Creado'),
		available: s('success', 'Disponible'),
		delivered_to_collector: s('info', 'Entregado al cobrador'),
		sold: s('info', 'Vendido'),
		returned: s('warning', 'Devuelto'),
		lost: s('danger', 'Extraviado'),
		annulled: s('danger', 'Anulado'),
		closed: s('neutral', 'Cerrado')
	} satisfies Record<BondCommercialStatus, StatusMeta>,
	bondFinancial: {
		no_payments: s('neutral', 'Sin pagos'),
		partial_payments: s('warning', 'Pagos parciales'),
		up_to_date: s('success', 'Al día'),
		overdue: s('danger', 'En mora'),
		fully_paid: s('success', 'Pagado'),
		uncollectible: s('danger', 'Incobrable'),
		annulled: s('danger', 'Anulado')
	} satisfies Record<BondFinancialStatus, StatusMeta>,
	importSession: {
		draft: s('neutral', 'Borrador'),
		validated: s('info', 'Validada'),
		confirmed: s('success', 'Confirmada'),
		cancelled: s('neutral', 'Cancelada'),
		failed: s('danger', 'Fallida'),
		rolled_back: s('warning', 'Revertida')
	} satisfies Record<ImportSessionDisplayStatus, StatusMeta>,
	importItem: {
		pending: s('neutral', 'Pendiente'),
		valid: s('success', 'Válido'),
		warning: s('warning', 'Con observaciones'),
		error: s('danger', 'Con error'),
		removed: s('neutral', 'Quitado')
	} satisfies Record<ImportItemDisplayStatus, StatusMeta>,
	sale: {
		active: s('success', 'Activa'),
		annulled: s('danger', 'Anulada'),
		corrected: s('info', 'Corregida')
	} satisfies Record<SaleStatus, StatusMeta>,
	paymentPlan: {
		active: s('success', 'Activo'),
		annulled: s('danger', 'Anulado')
	} satisfies Record<PaymentPlanStatus, StatusMeta>,
	installment: {
		pending: s('warning', 'Pendiente'),
		paid: s('success', 'Pagada'),
		paid_advance: s('success', 'Pagada por adelantado'),
		overdue: s('danger', 'Vencida'),
		annulled: s('danger', 'Anulada')
	} satisfies Record<InstallmentStatus, StatusMeta>,
	payment: {
		draft: s('neutral', 'Borrador'),
		pending_in_settlement: s('warning', 'Pendiente de rendición'),
		confirmed: s('success', 'Confirmado'),
		annulled: s('danger', 'Anulado'),
		adjusted: s('info', 'Ajustado')
	} satisfies Record<PaymentStatus, StatusMeta>,
	settlement: {
		open: s('warning', 'Abierta'),
		closed: s('info', 'Cerrada'),
		annulled: s('danger', 'Anulada'),
		corrected: s('info', 'Corregida')
	} satisfies Record<SettlementStatus, StatusMeta>,
	ledger: {
		recorded: s('success', 'Registrado'),
		annulled: s('danger', 'Anulado'),
		compensated: s('info', 'Compensado')
	} satisfies Record<LedgerStatus, StatusMeta>,
	collector: {
		active: s('success', 'Activo'),
		inactive: s('neutral', 'Inactivo')
	} satisfies Record<CollectorStatus, StatusMeta>,
	assignment: {
		active: s('success', 'Vigente'),
		returned: s('info', 'Devuelto'),
		reassigned: s('info', 'Reasignado'),
		lost: s('danger', 'Extraviado')
	} satisfies Record<AssignmentStatus, StatusMeta>,
	deliveryNote: {
		issued: s('success', 'Emitido'),
		annulled: s('danger', 'Anulado')
	} satisfies Record<DeliveryNoteStatus, StatusMeta>,
	commissionRule: {
		active: s('success', 'Activa'),
		annulled: s('danger', 'Anulada')
	} satisfies Record<CommissionRuleStatus, StatusMeta>,
	draw: {
		scheduled: s('neutral', 'Programado'),
		roster_generated: s('info', 'Padrón generado'),
		roster_frozen: s('info', 'Padrón congelado'),
		completed: s('success', 'Realizado'),
		closed: s('neutral', 'Cerrado'),
		annulled: s('danger', 'Anulado')
	} satisfies Record<DrawStatus, StatusMeta>,
	roster: {
		generated: s('info', 'Generado'),
		frozen: s('success', 'Congelado'),
		superseded: s('neutral', 'Reemplazado')
	} satisfies Record<DrawRosterStatus, StatusMeta>,
	prize: {
		pending_validation: s('warning', 'Pendiente de validación'),
		awarded: s('success', 'Adjudicado'),
		pending_delivery: s('warning', 'Pendiente de entrega'),
		delivered: s('info', 'Entregado'),
		unawarded: s('neutral', 'No adjudicado'),
		annulled: s('danger', 'Anulado')
	} satisfies Record<PrizeStatus, StatusMeta>,
	winningNumber: {
		pending_review: s('warning', 'Pendiente de revisión'),
		eligible_winner: s('success', 'Ganador habilitado'),
		not_eligible: s('danger', 'No habilitado'),
		no_match: s('neutral', 'Sin coincidencia')
	} satisfies Record<WinningNumberStatus, StatusMeta>,
	prizeAward: {
		awarded: s('success', 'Adjudicado'),
		delivered: s('info', 'Entregado'),
		annulled: s('danger', 'Anulado')
	} satisfies Record<PrizeAwardStatus, StatusMeta>
} as const;

export type StatusKind = keyof typeof STATUS_MAP;
export type StatusOf<K extends StatusKind> = keyof (typeof STATUS_MAP)[K] & string;

export function statusMeta<K extends StatusKind>(kind: K, status: StatusOf<K>): StatusMeta {
	return (STATUS_MAP[kind] as Record<string, StatusMeta>)[status];
}

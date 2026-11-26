/** Codes are retained in the detail; unknown future codes never escape into the list. */
export const AUDIT_ENTITIES: Record<string, string> = {
	bond: 'Bono',
	sale: 'Venta',
	payment: 'Pago',
	settlement: 'Rendición',
	collector: 'Cobrador',
	buyer: 'Comprador',
	campaign: 'Campaña',
	draw: 'Sorteo',
	draw_roster: 'Padrón de sorteo',
	prize: 'Premio',
	commission_rule: 'Regla de comisión',
	collector_ledger_entry: 'Movimiento de cuenta',
	collector_ledger: 'Cuenta del cobrador',
	delivery_note: 'Remito',
	import: 'Importación',
	import_batch: 'Importación',
	user: 'Usuario',
	profile: 'Usuario',
	payment_correction: 'Corrección de pago',
	sale_correction: 'Corrección de venta',
	settlement_correction: 'Corrección de rendición',
	commission: 'Comisión'
};
const VERBS: Record<string, string> = {
	create: 'Registro creado',
	update: 'Datos actualizados',
	annul: 'Registro anulado',
	add: 'Pago agregado',
	deliver: 'Entrega registrada',
	assign: 'Asignación registrada',
	group: 'Pata formada',
	ungroup: 'Pata desagrupada',
	import: 'Bonos importados',
	mark_lost: 'Bono extraviado',
	reassign: 'Bono reasignado',
	return: 'Bono devuelto',
	scan: 'Número leído',
	close: 'Cierre registrado',
	transition: 'Estado cambiado',
	update_rules: 'Reglas actualizadas',
	update_overdue_warning: 'Aviso de mora actualizado',
	adjust: 'Ajuste registrado',
	settle: 'Comisión liquidada',
	issue: 'Remito emitido',
	complete: 'Sorteo finalizado',
	freeze_roster: 'Padrón congelado',
	generate_roster: 'Padrón generado',
	load_winner: 'Resultado registrado',
	cancel: 'Importación cancelada',
	confirm: 'Importación confirmada',
	confirm_rejected: 'Confirmación rechazada',
	remove_item: 'Fila quitada',
	rollback: 'Importación revertida',
	stage: 'Archivo preparado',
	update_item: 'Fila actualizada',
	validate: 'Archivo validado',
	collector_attach: 'Cobro incluido',
	collector_reject: 'Cobro rechazado',
	collector_submit: 'Cobro enviado',
	correct_method: 'Medio de pago corregido',
	reassociate_transfer: 'Transferencia reasociada',
	resolve: 'Premio resuelto',
	reverse_delivery: 'Entrega de premio revertida',
	correct: 'Corrección registrada',
	mark_uncollectible: 'Venta marcada como incobrable',
	revert_uncollectible: 'Marca de incobrable revertida',
	open: 'Rendición abierta',
	update_open: 'Rendición actualizada'
};
export const auditAction = (code: string) =>
	VERBS[code.split('.').slice(1).join('.')] ?? 'Cambio registrado';
export const auditEntity = (code: string) => AUDIT_ENTITIES[code] ?? 'Registro';

/** Known audit actions, independent of the currently displayed page or person filter. */
export const AUDIT_ACTION_CODES = [
	'bond.annul',
	'bond.assign',
	'bond.create',
	'bond.deliver',
	'bond.group',
	'bond.import',
	'bond.mark_lost',
	'bond.reassign',
	'bond.return',
	'bond.scan',
	'bond.ungroup',
	'buyer.create',
	'buyer.update',
	'campaign.close',
	'campaign.create',
	'campaign.transition',
	'campaign.update',
	'campaign.update_overdue_warning',
	'campaign.update_rules',
	'collector.create',
	'collector.update',
	'collector_ledger.adjust',
	'collector_ledger.annul',
	'commission.adjust',
	'commission.settle',
	'commission_rule.annul',
	'commission_rule.create',
	'commission_rule.update',
	'delivery_note.issue',
	'draw.annul',
	'draw.complete',
	'draw.create',
	'draw.freeze_roster',
	'draw.generate_roster',
	'draw.load_winner',
	'draw.update',
	'import.cancel',
	'import.confirm',
	'import.confirm_rejected',
	'import.create',
	'import.remove_item',
	'import.rollback',
	'import.scan',
	'import.stage',
	'import.update_item',
	'import.validate',
	'payment.add',
	'payment.annul',
	'payment.collector_attach',
	'payment.collector_reject',
	'payment.collector_submit',
	'payment.correct_method',
	'payment.reassociate_transfer',
	'prize.annul',
	'prize.create',
	'prize.deliver',
	'prize.resolve',
	'prize.reverse_delivery',
	'prize.update',
	'sale.correct',
	'sale.create',
	'sale.mark_uncollectible',
	'sale.revert_uncollectible',
	'settlement.close',
	'settlement.correct',
	'settlement.open',
	'settlement.update_open',
	'user.create'
];

export function snapshotReferences(value: unknown): Record<string, string[]> {
	const refs: Record<string, string[]> = {};
	function visit(item: unknown) {
		if (!item || typeof item !== 'object') return;
		const entity = item as Record<string, unknown>;
		if (
			typeof entity.type === 'string' &&
			typeof entity.id === 'string' &&
			['bond', 'sale', 'payment', 'collector', 'buyer', 'settlement'].includes(entity.type)
		)
			(refs[`${entity.type}_id`] ??= []).push(entity.id);
		for (const [key, v] of Object.entries(item)) {
			if (typeof v === 'string' && /^(bond|sale|payment|collector|buyer|settlement)_id$/.test(key))
				(refs[key] ??= []).push(v);
			else if (v && typeof v === 'object') visit(v);
		}
	}
	visit(value);
	return refs;
}

import { describe, expect, it, vi } from 'vitest';
import { describeAuditEntries } from './audit-presentation';
import { auditAction, auditEntity } from '$lib/audit-copy';
import type { AuditEntry } from './repositories/audit-log';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const entry = (overrides: Partial<AuditEntry> = {}): AuditEntry => ({
	id: id(1),
	action: 'payment.correct_method',
	entityType: 'payment',
	entityId: id(2),
	actorUserId: id(3),
	actorName: null,
	oldValue: null,
	newValue: {},
	reason: null,
	requestId: null,
	createdAt: '2026-11-01T12:00:00Z',
	...overrides
});
function client(tables: Record<string, Record<string, unknown>[]> = {}) {
	const reads: { table: string; ids: string[] }[] = [];
	const from = vi.fn((table: string) => ({
		select: () => ({
			in: (_key: string, ids: string[]) => ({
				order: async () => {
					reads.push({ table, ids });
					return {
						data: (tables[table] ?? []).filter((row) => ids.includes(String(row.id))),
						error: null
					};
				}
			})
		})
	}));
	return { supabase: { from } as never, from, reads };
}
describe('authorized audit context', () => {
	it('resolves a real nested payment correction to its bond, buyer and collector without profiles', async () => {
		const db = client({
			payments: [{ id: id(2), sale_id: id(4), collector_id: id(5) }],
			sales: [{ id: id(4), bond_id: id(6), buyer_id: id(7), collector_id: id(5) }],
			bonds: [{ id: id(6), bond_numbers: [{ number_value: 8, number_kind: 'base' }] }],
			buyers: [{ id: id(7), first_name: 'Ana', last_name: 'Pérez', business_name: null }],
			collectors: [{ id: id(5), display_name: 'Jorge Medina' }]
		});
		const rows = await describeAuditEntries(
			db.supabase,
			[
				entry({
					entityType: 'payment_correction',
					entityId: null,
					newValue: {
						previous_value: { payment: { id: id(2), sale_id: id(4), collector_id: id(5) } }
					}
				})
			],
			['payment.view', 'sale.view', 'bond.view', 'buyer.view', 'collector.view'],
			4
		);
		expect(rows[0].subject).toBe('Bono 0008, Ana Pérez, Jorge Medina');
		expect(db.reads.some((r) => r.table === 'profiles')).toBe(false);
	});
	it('does not read a party or a profile without permission and never uses a UUID as a label', async () => {
		const db = client();
		const rows = await describeAuditEntries(
			db.supabase,
			[entry({ newValue: { collector_id: id(5), buyer_id: id(7) } })],
			[],
			4
		);
		expect(db.from).not.toHaveBeenCalled();
		expect(rows[0].subject).toBe('Pago');
		expect(rows[0].subject).not.toContain(id(5));
		expect(auditAction('future.unknown')).toBe('Cambio registrado');
		expect(auditEntity('future_entity')).toBe('Registro');
	});
	it('reads the final bond beyond 1,000 references using bounded queries', async () => {
		const bonds = Array.from({ length: 1051 }, (_, i) => ({
			id: id(i + 10),
			bond_numbers: [{ number_value: i + 1, number_kind: 'base' }]
		}));
		const db = client({ bonds });
		const rows = await describeAuditEntries(
			db.supabase,
			bonds.map((bond) => entry({ entityType: 'bond', entityId: bond.id })),
			['bond.view'],
			4
		);
		expect(rows[1050].subject).toBe('Bono 1051');
		expect(db.reads.every((read) => read.ids.length <= 100)).toBe(true);
	});
});

import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { listInstallmentPaymentsForSale } from './sales';

function client(rows: unknown[] | null, error: Error | null = null) {
	const calls: { method: string; args: unknown[] }[] = [];
	const query: Record<string, unknown> = {};
	for (const method of ['select', 'neq', 'eq', 'order'])
		query[method] = (...args: unknown[]) => {
			calls.push({ method, args });
			return query;
		};
	query.overrideTypes = () => Promise.resolve({ data: rows, error });
	return {
		calls,
		supabase: {
			from: (table: string) => {
				calls.push({ method: 'from', args: [table] });
				return query;
			}
		} as unknown as SupabaseClient
	};
}

const application = (
	installment: string,
	amount: string | number,
	date: string,
	method = 'cash',
	settlement: number | null = null
) => ({
	installment_id: installment,
	amount_applied: amount,
	payments: {
		status: 'confirmed',
		payment_date: date,
		payment_method: method,
		settlement_id: settlement === null ? null : `s${settlement}`,
		settlements: settlement === null ? null : { settlement_number: settlement }
	}
});

describe('listInstallmentPaymentsForSale', () => {
	it('adds what was applied to each installment, in cents, and keeps the last payment', async () => {
		const { supabase } = client([
			application('i1', '2500.50', '2026-10-01', 'cash', 12),
			application('i1', 7499.5, '2026-10-09', 'transfer', 14),
			application('i2', '10000.00', '2026-11-02')
		]);
		const { data, error } = await listInstallmentPaymentsForSale(supabase, 'sale');
		expect(error).toBeNull();
		expect(data?.get('i1')).toEqual({
			applied: '10000.00',
			last: { date: '2026-10-09', method: 'transfer', settlementId: 's14', settlementNumber: 14 }
		});
		expect(data?.get('i2')).toEqual({
			applied: '10000.00',
			last: { date: '2026-11-02', method: 'cash', settlementId: null, settlementNumber: null }
		});
		expect(data?.get('i3')).toBeUndefined();
	});

	it('reads the active plan of that sale and leaves annulled payments out', async () => {
		const { supabase, calls } = client([]);
		const { data } = await listInstallmentPaymentsForSale(supabase, 'sale-1');
		expect(data?.size).toBe(0);
		expect(calls).toContainEqual({ method: 'from', args: ['payment_installments'] });
		expect(calls).toContainEqual({ method: 'neq', args: ['payments.status', 'annulled'] });
		expect(calls).toContainEqual({
			method: 'eq',
			args: ['installments.payment_plans.sale_id', 'sale-1']
		});
		expect(calls).toContainEqual({
			method: 'eq',
			args: ['installments.payment_plans.status', 'active']
		});
	});

	it('passes a failed read on', async () => {
		const failure = new Error('denied');
		expect(await listInstallmentPaymentsForSale(client(null, failure).supabase, 's')).toEqual({
			data: null,
			error: failure
		});
	});
});

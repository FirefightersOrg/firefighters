import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	getSettlement,
	listSettlements,
	listSettlementPayments,
	listBondPayments,
	listCollectorPaymentCandidates
} from './settlements';

function settlementClient(data: unknown) {
	const query = {
		select: () => query,
		eq: () => query,
		maybeSingle: () => query,
		overrideTypes: () => Promise.resolve({ data, error: null })
	};
	return { from: () => query } as unknown as SupabaseClient;
}

describe('getSettlement', () => {
	it('returns an empty successful result for a missing settlement so loaders can send 404', async () => {
		expect(await getSettlement(settlementClient(null), 'campaign', 'missing')).toEqual({
			data: null,
			error: null
		});
	});
	it('maps the stored financial snapshot used after closing', async () => {
		const result = await getSettlement(
			settlementClient({
				id: 'settlement',
				settlement_number: 7,
				collector_id: 'collector',
				collectors: { display_name: 'Ana' },
				status: 'closed',
				opened_at: '2026-01-01T00:00:00Z',
				closed_at: '2026-01-02T00:00:00Z',
				notes: null,
				total_cash: '12.34',
				total_transfer: '56.78',
				total_amount: '69.12',
				commission_amount: '6.91',
				commission_paid_amount: '2.00',
				net_to_firefighters: '62.21'
			}),
			'campaign',
			'settlement'
		);

		expect(result.data?.totals).toEqual({
			totalCash: '12.34',
			totalTransfer: '56.78',
			totalAmount: '69.12',
			commissionAmount: '6.91',
			commissionPaidAmount: '2.00',
			netToFirefighters: '62.21',
			collectorCreditBalance: '0.00'
		});
	});
});

type Row = Record<string, unknown>;
function pagedClient(tables: Record<string, Row[]>, failureAt?: number) {
	const ranges: Record<string, number[][]> = {};
	const calls: { method: string; args: unknown[] }[] = [];
	const from = vi.fn((table: string) => {
		let start = 0,
			end = 499;
		const query = {
			select: (...args: unknown[]) => {
				calls.push({ method: 'select', args });
				return query;
			},
			eq: (...args: unknown[]) => {
				calls.push({ method: 'eq', args });
				return query;
			},
			neq: (...args: unknown[]) => {
				calls.push({ method: 'neq', args });
				return query;
			},
			in: (...args: unknown[]) => {
				calls.push({ method: 'in', args });
				return query;
			},
			gte: (...args: unknown[]) => {
				calls.push({ method: 'gte', args });
				return query;
			},
			lte: (...args: unknown[]) => {
				calls.push({ method: 'lte', args });
				return query;
			},
			order: (...args: unknown[]) => {
				calls.push({ method: 'order', args });
				return query;
			},
			range: (a: number, b: number) => {
				start = a;
				end = b;
				(ranges[table] ??= []).push([a, b]);
				return query;
			},
			overrideTypes: () =>
				Promise.resolve(
					start === failureAt
						? { data: null, error: new Error('page failed') }
						: {
								data: (tables[table] ?? []).slice(start, Math.min(end + 1, start + 1000)),
								error: null
							}
				)
		};
		return query;
	});
	return { client: { from } as unknown as SupabaseClient, ranges, calls };
}
const snapshot = {
	total_cash: '1.00',
	total_transfer: '0.00',
	total_amount: '1.00',
	commission_amount: '0.00',
	commission_paid_amount: '0.00',
	net_to_firefighters: '1.00'
};
const installment = (id: string): Row => ({
	id,
	amount: '10.00',
	status: 'pending',
	installment_number: 1,
	due_date: '2026-01-01',
	payment_plans: { sales: { id: 'sale', buyers: { first_name: 'Ana' }, bonds: null } }
});

describe('settlement pagination', () => {
	it.each(['settlements', 'settlement payments', 'bond payments', 'candidates'])(
		'reads all 1201 %s rather than silently truncating at 1000',
		async (kind) => {
			const rows = Array.from({ length: 1201 }, (_, i) => ({
				...snapshot,
				...installment(String(i)),
				settlement_number: i,
				payment_method: 'cash'
			}));
			const table =
				kind === 'settlements'
					? 'settlements'
					: kind === 'candidates'
						? 'installments'
						: 'payments';
			const { client, ranges, calls } = pagedClient({ [table]: rows });
			const result =
				kind === 'settlements'
					? await listSettlements(client, 'campaign')
					: kind === 'settlement payments'
						? await listSettlementPayments(client, 'settlement')
						: kind === 'bond payments'
							? await listBondPayments(client, 'bond')
							: await listCollectorPaymentCandidates(client, 'campaign', 'collector');
			expect(result.error).toBeNull();
			expect(result.data).toHaveLength(1201);
			expect(result.data?.at(-1)?.id).toBe('1200');
			expect(ranges[table]).toEqual([
				[0, 499],
				[500, 999],
				[1000, 1499]
			]);
			expect(calls).toContainEqual({ method: 'order', args: ['id'] });
		}
	);
	it('reads the final empty page for an exact multiple and propagates later-page failures', async () => {
		const rows = Array.from({ length: 1000 }, (_, i) => ({ ...snapshot, id: String(i) }));
		const ok = pagedClient({ settlements: rows });
		expect((await listSettlements(ok.client, 'campaign')).data).toHaveLength(1000);
		expect(ok.ranges.settlements).toHaveLength(3);
		const failed = pagedClient({ settlements: rows }, 500);
		expect(await listSettlements(failed.client, 'campaign')).toEqual({
			data: null,
			error: new Error('page failed')
		});
	});
	it('lists open settlements first, each group newest first, also when an open one is on a later page', async () => {
		// As the query returns them: newest number first. Two are open, one of them on the second page.
		const rows = Array.from({ length: 502 }, (_, i) => {
			const number = 502 - i;
			return {
				...snapshot,
				id: `s${number}`,
				settlement_number: number,
				status: number === 500 || number === 1 ? 'open' : number === 499 ? 'corrected' : 'closed'
			};
		});
		const { client, ranges, calls } = pagedClient({ settlements: rows });
		const result = await listSettlements(client, 'campaign');
		const numbers = result.data!.map((item) => item.settlementNumber);
		expect(numbers).toHaveLength(502);
		expect(numbers.slice(0, 6)).toEqual([500, 1, 502, 501, 499, 498]);
		expect(numbers.at(-1)).toBe(2);
		expect(result.data!.slice(0, 3).map((item) => item.status)).toEqual(['open', 'open', 'closed']);
		// The query itself is the one it was: by number, newest first, read to the last page.
		expect(calls).toContainEqual({
			method: 'order',
			args: ['settlement_number', { ascending: false }]
		});
		expect(ranges.settlements).toEqual([
			[0, 499],
			[500, 999]
		]);
	});
	it('uses Buenos Aires day boundaries including the final microsecond', async () => {
		const { client, calls } = pagedClient({});
		await listSettlements(client, 'campaign', { from: '2026-01-01', to: '2026-01-02' });
		expect(calls).toContainEqual({
			method: 'gte',
			args: ['opened_at', '2026-01-01T00:00:00-03:00']
		});
		expect(calls).toContainEqual({
			method: 'lte',
			args: ['opened_at', '2026-01-02T23:59:59.999999-03:00']
		});
	});
	it('subtracts all 1201 live applications in cents and omits fully allocated installments', async () => {
		const applications = Array.from({ length: 1201 }, (_, i) => ({
			payment_id: String(i),
			installment_id: 'partial',
			amount_applied: '0.01'
		}));
		const { client, ranges, calls } = pagedClient({
			installments: [{ ...installment('partial'), amount: '20.00' }, installment('full')],
			payment_installments: [
				...applications,
				{ payment_id: 'full', installment_id: 'full', amount_applied: '10.00' }
			]
		});
		const result = await listCollectorPaymentCandidates(client, 'campaign', 'collector');
		expect(result.data).toEqual([expect.objectContaining({ id: 'partial', amount: '7.99' })]);
		expect(ranges.payment_installments).toHaveLength(3);
		expect(calls).toContainEqual({ method: 'neq', args: ['payments.status', 'annulled'] });
		expect(calls).toContainEqual({
			method: 'eq',
			args: ['installments.payment_plans.sales.campaign_id', 'campaign']
		});
		expect(calls).toContainEqual({
			method: 'eq',
			args: ['installments.payment_plans.sales.collector_id', 'collector']
		});
		expect(calls).toContainEqual({ method: 'order', args: ['payment_id'] });
		expect(calls).toContainEqual({ method: 'order', args: ['installment_id'] });
	});
	it('does not expose a misleading balance if application loading fails', async () => {
		const applications = Array.from({ length: 600 }, () => ({
			installment_id: 'partial',
			amount_applied: '0.01'
		}));
		const { client } = pagedClient(
			{
				installments: [installment('partial')],
				payment_installments: applications
			},
			500
		);
		expect(await listCollectorPaymentCandidates(client, 'campaign', 'collector')).toEqual({
			data: null,
			error: new Error('page failed')
		});
	});
});

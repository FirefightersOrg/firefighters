import { describe, expect, it, vi } from 'vitest';
import { getOverdueSales, getOverdueWarningThreshold, OVERDUE_PAGE_SIZE } from './reports';
import { mockSupabase } from '../../../routes/campaigns/test-helpers';

const CAMPAIGN = 'a0000000-0000-4000-8000-000000000001';
const row = (n: number) => ({
	sale_id: `s${n}`,
	bond_id: `b${n}`,
	bond_label: null,
	collector_id: 'c',
	collector_name: 'Ana',
	overdue_count: '3',
	overdue_amount: '300.00',
	oldest_due_date: '2027-01-10'
});

describe('getOverdueSales (SAN-142)', () => {
	it('reads every page until a short one, and maps rows', async () => {
		const rpc = vi
			.fn()
			.mockResolvedValueOnce({
				data: Array.from({ length: OVERDUE_PAGE_SIZE }, (_, i) => row(i)),
				error: null
			})
			.mockResolvedValueOnce({ data: [row(OVERDUE_PAGE_SIZE)], error: null });
		const result = await getOverdueSales({ rpc } as never, CAMPAIGN, { collectorId: null });
		expect(result.data).toHaveLength(OVERDUE_PAGE_SIZE + 1);
		expect(result.data![0]).toEqual({
			saleId: 's0',
			bondId: 'b0',
			bondLabel: '—',
			collectorId: 'c',
			collectorName: 'Ana',
			overdueCount: 3,
			overdueAmount: '300.00',
			oldestDueDate: '2027-01-10'
		});
		expect(rpc.mock.calls.map(([, args]) => args.p_offset)).toEqual([0, OVERDUE_PAGE_SIZE]);
	});
	it('returns the error of a failing page', async () => {
		const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
		expect(await getOverdueSales({ rpc } as never, CAMPAIGN, { collectorId: null })).toMatchObject({
			data: null,
			error: { message: 'boom' }
		});
	});
});

describe('getOverdueWarningThreshold (SAN-142)', () => {
	it('reads N and falls back to 3', async () => {
		const set = mockSupabase({
			tables: { campaigns: { data: { overdue_warning_threshold: 7 }, error: null } }
		});
		expect((await getOverdueWarningThreshold(set.supabase, CAMPAIGN)).data).toBe(7);
		const unset = mockSupabase({ tables: { campaigns: { data: null, error: null } } });
		expect((await getOverdueWarningThreshold(unset.supabase, CAMPAIGN)).data).toBe(3);
		const failed = mockSupabase({ tables: { campaigns: { data: null, error: { message: 'x' } } } });
		expect((await getOverdueWarningThreshold(failed.supabase, CAMPAIGN)).error).toBeTruthy();
	});
});

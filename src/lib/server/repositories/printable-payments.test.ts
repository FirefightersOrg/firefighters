import { describe, expect, it } from 'vitest';
import { mockSupabase } from '../../../routes/campaigns/test-helpers';
import { getPaymentCertificate, getSettlementPrint } from './printable-payments';

describe('printable payments repository', () => {
	it('preserves SQL payment dates without manufacturing a timestamp', async () => {
		const { supabase } = mockSupabase({
			tables: {
				payments: {
					data: {
						id: 'payment',
						status: 'confirmed',
						payment_date: '2026-11-18',
						created_at: '2026-11-18T15:30:00Z',
						amount: '100.00',
						payment_method: 'cash'
					},
					error: null
				}
			}
		});
		const result = await getPaymentCertificate(supabase, 'campaign', 'payment');
		expect(result.data?.payment.paymentDate).toBe('2026-11-18');
		expect(result.data?.payment.createdAt).toBe('2026-11-18T15:30:00Z');
	});

	it.each(['closed', 'annulled', 'corrected'])(
		'preserves closing snapshot totals for %s notes even when current rows differ',
		async (status) => {
			const { supabase, chains, rpc } = mockSupabase({
				tables: {
					settlements: {
						data: {
							settlement_number: 7,
							status,
							opened_at: '2026-11-18T15:30:00Z',
							closed_at: '2026-11-18T16:00:00Z',
							total_cash: '150.00',
							total_transfer: '0.00',
							total_amount: '150.00',
							commission_amount: '10.00',
							commission_paid_amount: '10.00',
							net_to_firefighters: '140.00'
						},
						error: null
					},
					payments: {
						data: [{ amount: '100.00', payment_method: 'cash', payment_date: '2026-11-18' }],
						error: null
					}
				}
			});
			const result = await getSettlementPrint(supabase, 'campaign', 'settlement');
			expect(result.error).toBeNull();
			expect(result.data?.totals).toMatchObject({ amount: '150.00', balance: '0.00' });
			expect(result.data?.payments).toHaveLength(1);
			expect(result.data?.payments[0].amount).toBe('100.00');
			expect(chains.payments[0].in).toHaveBeenCalledWith('status', ['confirmed']);
			expect(rpc).not.toHaveBeenCalled();
		}
	);
});

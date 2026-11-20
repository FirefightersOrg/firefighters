import { beforeEach, describe, expect, it, vi } from 'vitest';
import { load } from './+page.server';
import { CAMPAIGN_ID, campaignRow, makeLocals, mockSupabase } from '../../../../test-helpers';
vi.mock('$lib/server/repositories/printable-payments', () => ({ getPaymentCertificate: vi.fn() }));
import { getPaymentCertificate } from '$lib/server/repositories/printable-payments';
const ID = 'd0000000-0000-0000-0000-000000000001';
const payment = {
	id: ID,
	bond: '68',
	buyer: 'Buyer',
	collector: 'Ana',
	installments: 'Installment 1',
	amount: '100.00',
	method: 'Cash',
	paymentDate: '2026-11-18',
	createdAt: '2026-11-18T15:30:00Z',
	registeredBy: 'Operator',
	settlementNumber: 7
};
const event = (locals: App.Locals, paymentId = ID) =>
	({
		locals,
		params: { id: CAMPAIGN_ID, paymentId },
		url: new URL(`http://localhost/campaigns/${CAMPAIGN_ID}/payments/${paymentId}/print`)
	}) as unknown as Parameters<typeof load>[0];
const setup = (permissions = ['campaign.view', 'payment.view']) =>
	makeLocals({
		supabase: mockSupabase({ tables: { campaigns: { data: campaignRow(), error: null } } })
			.supabase,
		permissions
	});
describe('payment certificate load', () => {
	beforeEach(() => {
		vi.mocked(getPaymentCertificate).mockReset();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});
	it('denies without payment.view', async () => {
		await expect(load(event(setup(['campaign.view'])))).rejects.toMatchObject({ status: 403 });
	});
	it('returns 404 for malformed or missing payments', async () => {
		await expect(load(event(setup(), 'bad'))).rejects.toMatchObject({ status: 404 });
		vi.mocked(getPaymentCertificate).mockResolvedValue({ data: null, error: null });
		await expect(load(event(setup()))).rejects.toMatchObject({ status: 404 });
	});
	it.each(['pending_in_settlement', 'annulled'])(
		'does not issue certificates for %s payments',
		async (status) => {
			vi.mocked(getPaymentCertificate).mockResolvedValue({
				data: { status, payment },
				error: null
			});
			await expect(load(event(setup()))).rejects.toMatchObject({ status: 404 });
		}
	);
	it('logs repository failures as 500', async () => {
		vi.mocked(getPaymentCertificate).mockResolvedValue({ data: null, error: new Error('db') });
		await expect(load(event(setup()))).rejects.toMatchObject({ status: 500 });
		expect(console.error).toHaveBeenCalled();
	});
});

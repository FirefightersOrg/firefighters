import { beforeEach, describe, expect, it, vi } from 'vitest';
import { load } from './+page.server';
import { CAMPAIGN_ID, campaignRow, makeLocals, mockSupabase } from '../../../../test-helpers';
vi.mock('$lib/server/repositories/printable-payments', () => ({ getSettlementPrint: vi.fn() }));
import { getSettlementPrint } from '$lib/server/repositories/printable-payments';
const ID = 'd0000000-0000-0000-0000-000000000001';
const source = (status: 'open' | 'closed' = 'closed') => ({
	settlementNumber: 7,
	status,
	openedAt: '2026-11-18T15:30:00Z',
	closedAt: status === 'closed' ? '2026-11-18T16:00:00Z' : null,
	collector: 'Ana',
	closedBy: status === 'closed' ? 'Operator' : null,
	notes: 'Box',
	totals: {
		cash: '100.00',
		transfer: '50.00',
		amount: '150.00',
		commission: '10.00',
		commissionPaid: '10.00',
		net: '140.00',
		balance: '0.00'
	},
	payments: [
		{ bond: '68', buyer: 'Buyer', installments: 'Installment 1', method: 'Cash', amount: '100.00' }
	]
});
const event = (locals: App.Locals, settlementId = ID) =>
	({
		locals,
		params: { id: CAMPAIGN_ID, settlementId },
		url: new URL(`http://localhost/campaigns/${CAMPAIGN_ID}/settlements/${settlementId}/print`)
	}) as unknown as Parameters<typeof load>[0];
const setup = (permissions: string[] | null = ['campaign.view', 'settlement.view']) =>
	makeLocals({
		supabase: mockSupabase({ tables: { campaigns: { data: campaignRow(), error: null } } })
			.supabase,
		permissions
	});
describe('settlement print load', () => {
	beforeEach(() => {
		vi.mocked(getSettlementPrint).mockReset();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});
	it('denies users without a settlement read permission', async () => {
		await expect(load(event(setup(['campaign.view'])))).rejects.toMatchObject({ status: 403 });
	});
	it('returns 500 rather than 403 when permissions could not be loaded', async () => {
		await expect(load(event(setup(null)))).rejects.toMatchObject({ status: 500 });
		expect(getSettlementPrint).not.toHaveBeenCalled();
	});
	it('returns 404 for malformed or missing settlements', async () => {
		await expect(load(event(setup(), 'bad'))).rejects.toMatchObject({ status: 404 });
		vi.mocked(getSettlementPrint).mockResolvedValue({ data: null, error: null });
		await expect(load(event(setup()))).rejects.toMatchObject({ status: 404 });
	});
	it('uses stored totals for a closed settlement', async () => {
		vi.mocked(getSettlementPrint).mockResolvedValue({ data: source(), error: null });
		const result = await load(event(setup()));
		expect(result?.document).toMatchObject({ preliminary: false, totals: { amount: '$ 150,00' } });
	});
	it('marks open settlements preliminary with RPC totals supplied by the repository', async () => {
		vi.mocked(getSettlementPrint).mockResolvedValue({ data: source('open'), error: null });
		const result = await load(event(setup()));
		expect(result?.document).toMatchObject({ preliminary: true, closingDate: '—' });
	});
	it('logs repository failures as 500', async () => {
		vi.mocked(getSettlementPrint).mockResolvedValue({ data: null, error: new Error('db') });
		await expect(load(event(setup()))).rejects.toMatchObject({ status: 500 });
		expect(console.error).toHaveBeenCalled();
	});
});

describe('settlement print closing user (SAN-122)', () => {
	const withRpc = (rpc: { data: unknown; error: unknown }) => {
		const mock = mockSupabase({
			tables: { campaigns: { data: campaignRow(), error: null } },
			rpc: rpc as never
		});
		return {
			mock,
			locals: makeLocals({
				supabase: mock.supabase,
				permissions: ['campaign.view', 'settlement.view']
			})
		};
	};
	beforeEach(() => {
		vi.mocked(getSettlementPrint).mockReset();
		vi.mocked(getSettlementPrint).mockResolvedValue({
			data: { ...source(), closedBy: null },
			error: null
		} as never);
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});
	it('shows the closing user from document_actor_name', async () => {
		const { mock, locals } = withRpc({ data: 'Treasurer Two', error: null });
		const result = (await load(event(locals)))! as { document: Record<string, unknown> };
		expect(JSON.stringify(result.document)).toContain('Treasurer Two');
		expect(mock.rpc).toHaveBeenCalledWith('document_actor_name', {
			p_kind: 'settlement',
			p_id: ID
		});
	});
	it('answers 500 when the lookup fails', async () => {
		await expect(
			load(event(withRpc({ data: null, error: { code: '42501', message: 'denied' } }).locals))
		).rejects.toMatchObject({ status: 500 });
	});
});

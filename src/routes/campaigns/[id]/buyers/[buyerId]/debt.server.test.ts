import { describe, expect, it } from 'vitest';
import { load } from './+page.server';
import {
	ADMIN_PERMISSIONS,
	CAMPAIGN_ID,
	campaignRow,
	makeLocals,
	mockSupabase
} from '../../../test-helpers';

/**
 * What the buyer record's load adds to say what is owed (UX plan PR 15): the installments of each
 * active sale with what its payments applied, the collectors' names the role can read, today, and
 * what the role may do. The `update` action and the rest of the load are in `page.server.test.ts`.
 */
const BUYER_ID = 'b0000000-0000-0000-0000-000000000001';
const PAGE_URL = `http://localhost/campaigns/${CAMPAIGN_ID}/buyers/${BUYER_ID}`;
const VIEWER = [...ADMIN_PERMISSIONS, 'buyer.view'];
const buyer = {
	id: BUYER_ID,
	type: 'individual',
	first_name: 'Ada',
	last_name: 'Lovelace',
	business_name: null,
	document_number: null,
	tax_id: null,
	phone: null,
	address: null,
	usual_collector_id: null,
	notes: null,
	created_by: null,
	created_at: '2026-01-01T00:00:00Z',
	updated_at: '2026-01-01T00:00:00Z'
};
const saleRow = (id: string, status: string, collector: unknown) => ({
	id,
	campaign_id: CAMPAIGN_ID,
	bond_id: `bond-${id}`,
	buyer_id: BUYER_ID,
	collector_id: `collector-${id}`,
	sold_at: '2026-09-12T15:00:00Z',
	payment_mode: 'installments',
	total_amount: '20000.00',
	status,
	created_by: 'u',
	created_at: '2026-09-12T15:00:00Z',
	updated_at: '2026-09-12T15:00:00Z',
	buyers: { first_name: 'Ada', last_name: 'Lovelace', business_name: null },
	collectors: collector,
	bonds: { financial_status_snapshot: 'partial_payments', bond_numbers: [] }
});
const installmentRow = (id: string, number: number, status: string) => ({
	id,
	payment_plan_id: 'plan',
	installment_number: number,
	due_date: `2026-1${number}-10`,
	amount: '10000.00',
	status,
	updated_at: '2026-09-12T15:00:00Z'
});

function setup(
	permissions: string[],
	payments: { data: unknown; error: unknown } = {
		data: [
			{
				installment_id: 'i1',
				amount_applied: '10000.00',
				payments: {
					status: 'confirmed',
					payment_date: '2026-10-09',
					payment_method: 'cash',
					settlement_id: 's',
					settlements: { settlement_number: 14 }
				}
			},
			{
				installment_id: 'i2',
				amount_applied: '4000.00',
				payments: {
					status: 'pending_in_settlement',
					payment_date: '2026-11-09',
					payment_method: 'cash',
					settlement_id: 's2',
					settlements: { settlement_number: 15 }
				}
			}
		],
		error: null
	}
) {
	const mock = mockSupabase({
		tables: {
			campaigns: { data: campaignRow(), error: null },
			buyers: { data: buyer, error: null },
			collectors: { data: [], error: null },
			bonds: { data: [], error: null },
			sales: {
				data: [
					saleRow('active', 'active', { display_name: 'Héctor Acosta' }),
					// An annulled sale is listed, but its installments are not read.
					saleRow('annulled', 'annulled', null)
				],
				error: null,
				count: 2
			},
			installments: [
				// The record's own list of pending installments, then the active sale's plan.
				{ data: [], error: null, count: 0 },
				{ data: [installmentRow('i1', 1, 'paid'), installmentRow('i2', 2, 'pending')], error: null }
			],
			payment_installments: payments
		}
	});
	return { ...mock, locals: makeLocals({ supabase: mock.supabase, permissions }) };
}
const event = (locals: App.Locals) =>
	({ locals, params: { id: CAMPAIGN_ID, buyerId: BUYER_ID }, url: new URL(PAGE_URL) }) as never;

describe('/campaigns/[id]/buyers/[buyerId]: what is owed', () => {
	it('reads the installments of each active sale with what confirmed payments applied', async () => {
		const test = setup(VIEWER);
		const data = await load(event(test.locals));
		expect(data?.saleInstallments).toEqual({
			active: [
				{
					number: 1,
					dueDate: '2026-11-10',
					amount: '10000.00',
					applied: '10000.00',
					status: 'paid'
				},
				// A payment still in an open settlement does not count as paid yet.
				{ number: 2, dueDate: '2026-12-10', amount: '10000.00', applied: '0.00', status: 'pending' }
			]
		});
		// One read of the plan and one of its payments, for the active sale only.
		expect(test.chains.installments).toHaveLength(2);
		expect(test.chains.payment_installments).toHaveLength(1);
		expect(data?.sales.map((item: { sale: { id: string } }) => item.sale.id)).toEqual([
			'active',
			'annulled'
		]);
		expect(data?.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it('gives only the collector names the role can read', async () => {
		const data = await load(event(setup(VIEWER).locals));
		expect(data?.saleCollectors).toEqual({ active: 'Héctor Acosta' });
		expect(JSON.stringify(data?.saleCollectors)).not.toMatch(/Sin acceso|Unknown/);
	});

	it('says what the role can read and do', async () => {
		const viewer = await load(event(setup(VIEWER).locals));
		expect(viewer).toMatchObject({ canViewPayments: false, canPay: false });
		const treasurer = await load(
			event(setup([...VIEWER, 'payment.view', 'settlement.create']).locals)
		);
		expect(treasurer).toMatchObject({ canViewPayments: true, canPay: true });
	});

	it('fails the page when the payments of a sale cannot be read', async () => {
		const test = setup(VIEWER, { data: null, error: { message: 'boom' } });
		await expect(load(event(test.locals))).rejects.toMatchObject({ status: 500 });
	});
});

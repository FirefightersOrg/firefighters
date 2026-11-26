import { describe, expect, it } from 'vitest';
import { load } from './+page.server';
import { CAMPAIGN_ID, campaignRow, makeLocals, mockSupabase } from '../../../test-helpers';

/**
 * What the collector record's load adds for its summary (UX plan PR 15): the unpaid installments
 * with what each still owes, today, and what the role may do next. The actions and the rest of the
 * load are covered by `page.server.test.ts`.
 */
const COLLECTOR_ID = 'c0000000-0000-0000-0000-000000000001';
const BOND_ID = 'b0000000-0000-0000-0000-000000000001';
const WRITTEN_OFF_BOND_ID = 'b0000000-0000-0000-0000-000000000002';
const VIEWER = ['campaign.view', 'collector.view'];

const collectorRow = {
	id: COLLECTOR_ID,
	display_name: 'Ada Collector',
	phone: null,
	email: null,
	address: null,
	user_profile_id: null,
	status: 'active',
	created_by: null,
	created_at: '2026-11-18T00:00:00Z',
	updated_at: '2026-11-18T00:00:00Z'
};
const bondRow = (id: string, base: number, financial: string) => ({
	id,
	campaign_id: CAMPAIGN_ID,
	kind: 'simple',
	origin: 'printed',
	internal_code: null,
	barcode: null,
	commercial_status: 'sold',
	financial_status_snapshot: financial,
	commercial_unit_count: 1,
	total_value: '60000.00',
	created_at: '2026-11-18T00:00:00Z',
	base_numbers: [base],
	associated_numbers: [base + 5000],
	sort_number: base,
	group_pata_id: null
});
const sale = (id: string, bondId: string, base: number, buyer: unknown) => ({
	id,
	bond_id: bondId,
	buyers: buyer,
	bonds: {
		bond_numbers: [
			{ number_value: base, number_kind: 'base' },
			{ number_value: base + 5000, number_kind: 'associated' }
		]
	}
});
const ada = { first_name: 'Ada', last_name: 'Gómez', business_name: null };
const installment = (id: string, number: number, dueDate: string, sales: unknown) => ({
	id,
	installment_number: number,
	due_date: dueDate,
	amount: '10000.00',
	status: 'pending',
	payment_plans: { sales }
});

function setup(
	permissions: string[],
	campaign: Record<string, unknown> = {},
	// A payment that is not annulled took 4.000 of the first installment.
	applications: { data: unknown; error: unknown } = {
		data: [{ payment_id: 'p1', installment_id: 'i1', amount_applied: '4000.00' }],
		error: null
	}
) {
	const rows = [
		installment('i1', 2, '2026-10-10', sale('sale-1', BOND_ID, 68, ada)),
		installment('i2', 3, '2026-11-10', sale('sale-1', BOND_ID, 68, ada)),
		// A buyer the role cannot read, on a sale that was given up as uncollectible.
		installment('i3', 1, '2026-09-10', sale('sale-2', WRITTEN_OFF_BOND_ID, 70, null))
	];
	const mock = mockSupabase({
		tables: {
			campaigns: { data: campaignRow(campaign), error: null },
			collectors: [
				{ data: collectorRow, error: null },
				{ data: [], error: null }
			],
			bond_list: {
				data: [
					bondRow(BOND_ID, 68, 'partial_payments'),
					bondRow(WRITTEN_OFF_BOND_ID, 70, 'uncollectible')
				],
				error: null,
				count: 2
			},
			buyers: { data: [], error: null, count: 0 },
			profiles: { data: [], error: null },
			installments: { data: rows, error: null, count: 3 },
			payment_installments: applications,
			settlements: { data: [], error: null }
		}
	});
	return { ...mock, locals: makeLocals({ supabase: mock.supabase, permissions }) };
}
const event = (locals: App.Locals) =>
	({
		locals,
		params: { id: CAMPAIGN_ID, collectorId: COLLECTOR_ID },
		url: new URL(`http://localhost/campaigns/${CAMPAIGN_ID}/collectors/${COLLECTOR_ID}`)
	}) as unknown as Parameters<typeof load>[0];

describe('/campaigns/[id]/collectors/[collectorId]: what is left to collect', () => {
	it('lists every unpaid installment with what it still owes, its bond and its buyer', async () => {
		const data = await load(event(setup(VIEWER).locals));
		expect(data?.debts).toEqual([
			{
				id: 'i1',
				saleId: 'sale-1',
				bondNumbers: [68],
				buyerName: 'Ada Gómez',
				number: 2,
				dueDate: '2026-10-10',
				owed: '6000.00',
				status: 'pending',
				uncollectible: false
			},
			{
				id: 'i2',
				saleId: 'sale-1',
				bondNumbers: [68],
				buyerName: 'Ada Gómez',
				number: 3,
				dueDate: '2026-11-10',
				owed: '10000.00',
				status: 'pending',
				uncollectible: false
			},
			{
				id: 'i3',
				saleId: 'sale-2',
				bondNumbers: [70],
				// Never a stand-in for a name the role cannot read.
				buyerName: null,
				number: 1,
				dueDate: '2026-09-10',
				owed: '10000.00',
				status: 'pending',
				// Its bond carries the uncollectible mark.
				uncollectible: true
			}
		]);
		// The record's own list and total are untouched.
		expect(data?.installmentsTotal).toBe(3);
		expect(data?.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it('says what the role may do next and what it can read', async () => {
		const viewer = await load(event(setup(VIEWER).locals));
		expect(viewer?.can).toMatchObject({
			pay: false,
			deliver: false,
			viewPayments: false,
			viewSettlements: false
		});
		expect(viewer?.ledger).toBeNull();

		const treasurer = await load(
			event(
				setup([...VIEWER, 'settlement.create', 'settlement.view', 'payment.view'], {
					status: 'active'
				}).locals
			)
		);
		expect(treasurer?.can).toMatchObject({
			pay: true,
			deliver: false,
			viewPayments: true,
			viewSettlements: true
		});

		const operator = await load(
			event(
				setup([...VIEWER, 'bond.assign', 'settlement.update_open'], { status: 'active' }).locals
			)
		);
		expect(operator?.can).toMatchObject({ pay: true, deliver: true, viewPayments: false });
		// A campaign that no longer takes deliveries offers none.
		const closed = await load(
			event(setup([...VIEWER, 'bond.assign'], { status: 'closed' }).locals)
		);
		expect(closed?.can.deliver).toBe(false);
	});

	it('fails the page when what is owed cannot be read', async () => {
		const test = setup(VIEWER, {}, { data: null, error: { message: 'boom' } });
		await expect(load(event(test.locals))).rejects.toMatchObject({ status: 500 });
	});
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { load as salesLoadRaw } from './ventas/+page.server';
import { load as saleLoadRaw } from './ventas/[saleId]/+page.server';
import { load as buyersLoadRaw } from './compradores/+page.server';
import { load as buyerLoadRaw } from './compradores/[buyerId]/+page.server';
import { load as dueLoadRaw } from './por-cobrar/+page.server';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Loader = (event: never) => any;
const salesLoad = salesLoadRaw as unknown as Loader;
const saleLoad = saleLoadRaw as unknown as Loader;
const buyersLoad = buyersLoadRaw as unknown as Loader;
const buyerLoad = buyerLoadRaw as unknown as Loader;
const dueLoad = dueLoadRaw as unknown as Loader;
const CAMP = '33333333-3333-4333-8333-333333333333';
const SALE = '11111111-1111-4111-8111-111111111111';
const BUYER = '22222222-2222-4222-8222-222222222222';

function setup(opts: { permissions?: string[] | null; rpc?: Record<string, unknown> } = {}) {
	const rpc = vi.fn(async (name: string) => {
		const result = opts.rpc?.[name];
		if (result instanceof Error) return { data: null, error: { message: result.message } };
		return { data: result ?? [], error: null };
	});
	const locals = {
		user: { id: 'u' },
		profile: { id: 'p' },
		permissions:
			opts.permissions === undefined ? ['bond.view_own', 'sale.view_own'] : opts.permissions,
		requestId: 'req',
		supabase: { rpc }
	} as unknown as App.Locals;
	return { rpc, locals };
}

const collectorRow = { portal_my_collector: [{ id: 'c1', display_name: 'Ana', status: 'active' }] };
const ev = (locals: App.Locals, path: string, params: Record<string, string> = {}) =>
	({
		locals,
		params: { campaignId: CAMP, ...params },
		url: new URL(`http://localhost${path}`)
	}) as never;

async function failure(fn: () => Promise<unknown>) {
	try {
		await fn();
	} catch (err) {
		return err;
	}
	throw new Error('expected a failure');
}

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('portal sales and buyers loads', () => {
	it('answers 500 when the permissions could not be loaded, on every screen', async () => {
		const { locals } = setup({ permissions: null });
		for (const run of [
			() => salesLoad(ev(locals, `/portal/${CAMP}/ventas`)),
			() => buyersLoad(ev(locals, `/portal/${CAMP}/compradores`)),
			() => dueLoad(ev(locals, `/portal/${CAMP}/por-cobrar`)),
			() => saleLoad(ev(locals, `/portal/${CAMP}/ventas/${SALE}`, { saleId: SALE })),
			() => buyerLoad(ev(locals, `/portal/${CAMP}/compradores/${BUYER}`, { buyerId: BUYER }))
		]) {
			expect(await failure(run)).toMatchObject({ status: 500 });
		}
	});

	it('answers 403 without sale.view_own', async () => {
		const { locals } = setup({ permissions: ['bond.view_own'], rpc: collectorRow });
		expect(await failure(() => salesLoad(ev(locals, `/portal/${CAMP}/ventas`)))).toMatchObject({
			status: 403
		});
	});

	it('maps the sales page, passes a bounded offset and keeps the DB order', async () => {
		const row = (id: string) => ({
			sale_id: id,
			campaign_id: 'k',
			campaign_name: 'Campaña',
			number_digits: 4,
			bond_numbers: [68],
			buyer_id: BUYER,
			buyer_name: 'Ada',
			buyer_phone: '11',
			sale_status: 'active',
			payment_mode: 'installments',
			total_amount: 300,
			paid_amount: 100,
			pending_amount: 0,
			balance: 200,
			overdue_count: 1,
			next_due_date: '2026-12-01',
			financial_status: 'overdue',
			sold_at: '2026-11-01T00:00:00Z',
			total_count: 45
		});
		const { locals, rpc } = setup({
			rpc: { ...collectorRow, portal_my_sales: [row('s2'), row('s1')] }
		});
		const out = (await salesLoad(ev(locals, `/portal/${CAMP}/ventas?page=3`)))!;
		expect(rpc).toHaveBeenCalledWith('portal_my_sales', {
			p_campaign_id: CAMP,
			p_limit: 20,
			p_offset: 40
		});
		expect(out.sales.map((s: any) => s.saleId)).toEqual(['s2', 's1']);
		expect(out.sales[0]).toMatchObject({ totalAmount: '300.00', balance: '200.00' });
		expect(out.pagination).toEqual({ page: 3, pageCount: 3 });
	});

	it('ignores an invalid page number', async () => {
		const { locals, rpc } = setup({ rpc: collectorRow });
		await salesLoad(ev(locals, `/portal/${CAMP}/ventas?page=-4`));
		expect(rpc).toHaveBeenCalledWith('portal_my_sales', expect.objectContaining({ p_offset: 0 }));
	});

	it('answers 404 for a foreign (no row), unknown or malformed sale and buyer', async () => {
		const { locals, rpc } = setup({ rpc: collectorRow });
		expect(await failure(() => saleLoad(ev(locals, '/x', { saleId: SALE })))).toMatchObject({
			status: 404
		});
		expect(await failure(() => buyerLoad(ev(locals, '/x', { buyerId: BUYER })))).toMatchObject({
			status: 404
		});
		rpc.mockClear();
		expect(await failure(() => saleLoad(ev(locals, '/x', { saleId: 'nope' })))).toMatchObject({
			status: 404
		});
		expect(rpc).not.toHaveBeenCalledWith('portal_my_sale', expect.anything());
	});

	it('answers 404 for a profile not linked to a collector', async () => {
		const { locals } = setup();
		expect(await failure(() => saleLoad(ev(locals, '/x', { saleId: SALE })))).toMatchObject({
			status: 404
		});
		expect(await salesLoad(ev(locals, `/portal/${CAMP}/ventas`))).toMatchObject({
			collector: null,
			sales: []
		});
	});

	it('answers 500 when a read function fails', async () => {
		const { locals } = setup({ rpc: { ...collectorRow, portal_my_sales: new Error('boom') } });
		expect(await failure(() => salesLoad(ev(locals, `/portal/${CAMP}/ventas`)))).toMatchObject({
			status: 500
		});
	});
});

describe('«Por cobrar»: what the collect sheet needs (UX plan PR 10)', () => {
	const due = (installment: string, sale: string) => ({
		sale_id: sale,
		campaign_name: 'C',
		number_digits: 4,
		bond_numbers: [68],
		buyer_id: BUYER,
		buyer_name: 'Ada',
		buyer_phone: null,
		buyer_address: sale === SALE ? 'Calle 1' : null,
		installment_id: installment,
		installment_number: 1,
		due_date: '2026-11-10',
		amount: 100,
		status: 'overdue',
		pending_amount: 0,
		balance: 100,
		total_count: 3
	});
	const OTHER_SALE = '11111111-1111-4111-8111-222222222222';
	const rows = {
		...collectorRow,
		portal_my_campaign_due_installments: [due('i1', SALE), due('i2', SALE), due('i3', OTHER_SALE)],
		portal_my_sale_reserved: [{ installment_id: 'i1', submitted_amount: 30 }]
	};

	it('adds what was already sent per installment, today, the note limit and a request key', async () => {
		const { rpc, locals } = setup({
			permissions: ['sale.view_own', 'payment.create_own'],
			rpc: rows
		});
		const data = await dueLoad(ev(locals, `/portal/${CAMP}/por-cobrar`));
		expect(data.due).toHaveLength(3);
		expect(data.due.map((item: { buyerAddress: string | null }) => item.buyerAddress)).toEqual([
			'Calle 1',
			'Calle 1',
			null
		]);
		expect(data.reserved).toEqual({ i1: '30.00' });
		expect(data.canRegister).toBe(true);
		expect(data.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(data.noteMax).toBeGreaterThan(0);
		expect(data.requestKey).toMatch(/^[0-9a-f-]{36}$/);
		// One read of the reserved amounts per sale of the page, not per installment.
		const reads = rpc.mock.calls.filter(
			(call) => (call as unknown[])[0] === 'portal_my_sale_reserved'
		) as unknown as [string, { p_sale_id: string }][];
		expect(reads.map((call) => call[1].p_sale_id).sort()).toEqual([SALE, OTHER_SALE].sort());
	});

	it('is read-only without payment.create_own or for an inactive collector', async () => {
		const noPermission = setup({ permissions: ['sale.view_own'], rpc: rows });
		expect((await dueLoad(ev(noPermission.locals, `/portal/${CAMP}/por-cobrar`))).canRegister).toBe(
			false
		);
		const inactive = setup({
			permissions: ['sale.view_own', 'payment.create_own'],
			rpc: {
				...rows,
				portal_my_collector: [{ id: 'c1', display_name: 'Ana', status: 'inactive' }]
			}
		});
		expect((await dueLoad(ev(inactive.locals, `/portal/${CAMP}/por-cobrar`))).canRegister).toBe(
			false
		);
	});

	it('fails with a 500 when the sent amounts cannot be read, instead of offering a wrong amount', async () => {
		const { locals } = setup({
			permissions: ['sale.view_own', 'payment.create_own'],
			rpc: { ...rows, portal_my_sale_reserved: new Error('boom') }
		});
		expect(await failure(() => dueLoad(ev(locals, `/portal/${CAMP}/por-cobrar`)))).toMatchObject({
			status: 500
		});
	});

	it('reads nothing more for an empty list or without a linked collector', async () => {
		const empty = setup({ rpc: { ...collectorRow, portal_my_campaign_due_installments: [] } });
		const data = await dueLoad(ev(empty.locals, `/portal/${CAMP}/por-cobrar`));
		expect(data).toMatchObject({ due: [], reserved: {} });
		expect(
			empty.rpc.mock.calls.some((call) => (call as unknown[])[0] === 'portal_my_sale_reserved')
		).toBe(false);
		const unlinked = setup({ rpc: { portal_my_collector: [] } });
		expect(await dueLoad(ev(unlinked.locals, `/portal/${CAMP}/por-cobrar`))).toMatchObject({
			collector: null,
			due: [],
			canRegister: false
		});
	});
});

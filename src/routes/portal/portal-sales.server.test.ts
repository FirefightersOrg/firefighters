import { beforeEach, describe, expect, it, vi } from 'vitest';
import { load as salesLoad } from './ventas/+page.server';
import { load as saleLoad } from './ventas/[saleId]/+page.server';
import { load as buyersLoad } from './compradores/+page.server';
import { load as buyerLoad } from './compradores/[buyerId]/+page.server';
import { load as dueLoad } from './por-cobrar/+page.server';

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
	({ locals, params, url: new URL(`http://localhost${path}`) }) as never;

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
			() => salesLoad(ev(locals, '/portal/ventas')),
			() => buyersLoad(ev(locals, '/portal/compradores')),
			() => dueLoad(ev(locals, '/portal/por-cobrar')),
			() => saleLoad(ev(locals, `/portal/ventas/${SALE}`, { saleId: SALE })),
			() => buyerLoad(ev(locals, `/portal/compradores/${BUYER}`, { buyerId: BUYER }))
		]) {
			expect(await failure(run)).toMatchObject({ status: 500 });
		}
	});

	it('answers 403 without sale.view_own', async () => {
		const { locals } = setup({ permissions: ['bond.view_own'], rpc: collectorRow });
		expect(await failure(() => salesLoad(ev(locals, '/portal/ventas')))).toMatchObject({
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
		const out = (await salesLoad(ev(locals, '/portal/ventas?page=3')))!;
		expect(rpc).toHaveBeenCalledWith('portal_my_sales', {
			p_campaign_id: null,
			p_limit: 20,
			p_offset: 40
		});
		expect(out.sales.map((s) => s.saleId)).toEqual(['s2', 's1']);
		expect(out.sales[0]).toMatchObject({ totalAmount: '300.00', balance: '200.00' });
		expect(out.pagination).toEqual({ page: 3, pageCount: 3 });
	});

	it('ignores an invalid page number', async () => {
		const { locals, rpc } = setup({ rpc: collectorRow });
		await salesLoad(ev(locals, '/portal/ventas?page=-4'));
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
		expect(await salesLoad(ev(locals, '/portal/ventas'))).toMatchObject({
			collector: null,
			sales: []
		});
	});

	it('answers 500 when a read function fails', async () => {
		const { locals } = setup({ rpc: { ...collectorRow, portal_my_sales: new Error('boom') } });
		expect(await failure(() => salesLoad(ev(locals, '/portal/ventas')))).toMatchObject({
			status: 500
		});
	});
});

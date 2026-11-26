/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';
import { actions as actionsRaw, load as loadRaw } from './ventas/[saleId]/+page.server';
import { buenosAiresToday } from '$lib/portal/labels';

const actions = actionsRaw as unknown as Record<string, (event: never) => Promise<any>>;
const load = loadRaw as unknown as (event: never) => Promise<any>;
const CAMP = '33333333-3333-4333-8333-333333333333';
const SALE = '11111111-1111-4111-8111-111111111111';
const INSTALLMENT = '22222222-2222-4222-8222-222222222222';
const collectorRow = [{ id: 'c1', display_name: 'Ana', status: 'active' }];

function setup(
	opts: { permissions?: string[]; rpc?: Record<string, unknown>; collector?: unknown } = {}
) {
	const rpc = vi.fn(async (name: string) => {
		const result = opts.rpc?.[name] as any;
		if (name === 'portal_my_collector')
			return { data: opts.collector ?? collectorRow, error: null };
		if (result && typeof result === 'object' && 'error' in result)
			return { data: null, error: result.error };
		return { data: result ?? [], error: null };
	});
	const locals = {
		user: { id: 'u' },
		profile: { id: 'p' },
		permissions: opts.permissions ?? ['bond.view_own', 'sale.view_own', 'payment.create_own'],
		requestId: 'req',
		supabase: { rpc }
	} as unknown as App.Locals;
	return { rpc, locals };
}
const post = (locals: App.Locals, fields: Record<string, string>) => {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.append(k, v);
	const path = `/portal/${CAMP}/ventas/${SALE}`;
	return {
		locals,
		params: { campaignId: CAMP, saleId: SALE },
		url: new URL(`http://localhost${path}`),
		request: new Request(`http://localhost${path}`, { method: 'POST', body })
	} as never;
};
const valid = {
	installmentId: INSTALLMENT,
	amount: '70,50',
	paymentMethod: 'cash',
	paymentDate: buenosAiresToday(),
	note: 'En mano',
	requestKey: '55555555-5555-4555-8555-555555555555'
};
const thrown = async (fn: () => Promise<unknown>) => {
	try {
		return { value: await fn() } as { value?: any; thrown?: any };
	} catch (e) {
		return { thrown: e } as { value?: any; thrown?: any };
	}
};
const submitCalls = (rpc: ReturnType<typeof setup>['rpc']) =>
	rpc.mock.calls.filter((call) => (call as unknown[])[0] === 'portal_payment_submit');

describe('portal "Registrar cobro" action (SAN-147)', () => {
	it('submits for the session collector and redirects (outside try) with the request key', async () => {
		const { rpc, locals } = setup({ rpc: { portal_payment_submit: 'pay-1' } });
		const result = await thrown(() => actions.registrar(post(locals, valid)));
		expect(result.thrown).toMatchObject({
			status: 303,
			location: `/portal/${CAMP}/ventas/${SALE}?enviado=1`
		});
		const call = submitCalls(rpc)[0] as unknown as [string, Record<string, unknown>];
		expect(call[1]).toMatchObject({
			p_sale_id: SALE,
			p_amount: 70.5,
			p_payment_method: 'cash',
			p_applications: [{ installment_id: INSTALLMENT, amount_applied: 70.5 }],
			p_request_id: valid.requestKey,
			p_note: 'En mano'
		});
		expect(Object.keys(call[1]).some((k) => k.includes('collector'))).toBe(false);
	});

	it('the sheet posts the amount as people write it: the database receives the same payment (UX plan PR 10)', async () => {
		// The sheet fills the amount in as «10.000,00»; the old form sent «10000.00». Same payment.
		const submitted = async (amount: string) => {
			const { rpc, locals } = setup({ rpc: { portal_payment_submit: 'pay-1' } });
			await thrown(() => actions.registrar(post(locals, { ...valid, amount, note: '' })));
			return (submitCalls(rpc)[0] as unknown as [string, Record<string, unknown>])[1];
		};
		const asWritten = await submitted('10.000,00');
		expect(asWritten).toEqual(await submitted('10000.00'));
		expect(asWritten).toMatchObject({
			p_amount: 10000,
			p_applications: [{ installment_id: INSTALLMENT, amount_applied: 10000 }]
		});
		// The fields the action reads are the ones the sheet sends, no more and no fewer.
		expect(Object.keys(valid).sort()).toEqual(
			['amount', 'installmentId', 'note', 'paymentDate', 'paymentMethod', 'requestKey'].sort()
		);
	});

	it('ignores a collector id sent in the form', async () => {
		const { rpc, locals } = setup({ rpc: { portal_payment_submit: 'pay-1' } });
		await thrown(() => actions.registrar(post(locals, { ...valid, collectorId: 'someone-else' })));
		expect(JSON.stringify(rpc.mock.calls)).not.toContain('someone-else');
	});

	it('rejects a future date (Buenos Aires today), bad amount and method before the database', async () => {
		const { rpc, locals } = setup();
		const later = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
		const result = await actions.registrar(
			post(locals, { ...valid, paymentDate: later, amount: '0', paymentMethod: 'check' })
		);
		expect(result.status).toBe(400);
		expect(result.data.errors).toMatchObject({
			paymentDate: ['La fecha del cobro no puede ser futura.'],
			amount: ['Ingresar un importe mayor que cero.'],
			paymentMethod: ['Elegir efectivo o transferencia.']
		});
		expect(result.data.installmentId).toBe(INSTALLMENT);
		expect(submitCalls(rpc)).toHaveLength(0);
	});

	it('shows a database refusal in Spanish and does not redirect', async () => {
		const { locals } = setup({
			rpc: {
				portal_payment_submit: {
					error: { code: '23514', message: 'payment applications exceed installment amount' }
				}
			}
		});
		const result = await thrown(() => actions.registrar(post(locals, valid)));
		expect(result.thrown).toBeUndefined();
		expect(result.value).toMatchObject({
			status: 400,
			data: { message: 'El importe supera el saldo de la cuota, contando los cobros pendientes.' }
		});
	});

	it('is 403 without payment.create_own, and refused for an inactive or missing collector', async () => {
		const noPermission = setup({ permissions: ['bond.view_own', 'sale.view_own'] });
		expect(
			(await thrown(() => actions.registrar(post(noPermission.locals, valid)))).thrown
		).toMatchObject({ status: 403 });
		const inactive = setup({ collector: [{ id: 'c1', display_name: 'Ana', status: 'inactive' }] });
		expect(await actions.registrar(post(inactive.locals, valid))).toMatchObject({ status: 403 });
		const unlinked = setup({ collector: [] });
		expect(await actions.registrar(post(unlinked.locals, valid))).toMatchObject({ status: 403 });
		for (const s of [noPermission, inactive, unlinked]) expect(submitCalls(s.rpc)).toHaveLength(0);
	});

	it('load exposes the register flag, Buenos Aires today and does not list sent collections twice', async () => {
		const saleRow = {
			sale_id: SALE,
			campaign_id: CAMP,
			campaign_name: 'C',
			number_digits: 4,
			bond_numbers: [1],
			buyer_id: 'b',
			buyer_name: 'Ada',
			buyer_phone: null,
			sale_status: 'active',
			payment_mode: 'installments',
			total_amount: 100,
			paid_amount: 0,
			pending_amount: 0,
			balance: 100,
			financial_status: 'no_payments',
			sold_at: '2026-11-01T00:00:00Z'
		};
		const { locals } = setup({
			rpc: {
				portal_my_sale: [saleRow],
				portal_my_sale_payments: [
					{
						payment_id: 'd',
						payment_date: '2026-11-01',
						amount: 10,
						payment_method: 'cash',
						status: 'draft'
					},
					{
						payment_id: 'c',
						payment_date: '2026-11-01',
						amount: 20,
						payment_method: 'cash',
						status: 'confirmed'
					}
				],
				portal_my_sale_submissions: [
					{
						payment_id: 'd',
						payment_date: '2026-11-01',
						amount: 10,
						payment_method: 'cash',
						status: 'draft',
						rejection_reason: null,
						note: null,
						created_at: '2026-11-01T00:00:00Z',
						installment_numbers: [1]
					}
				],
				portal_my_sale_reserved: [{ installment_id: INSTALLMENT, submitted_amount: 30 }]
			}
		});
		const data = await load({
			locals,
			params: { campaignId: CAMP, saleId: SALE },
			url: new URL(`http://localhost/portal/${CAMP}/ventas/${SALE}?enviado=1`)
		} as never);
		expect(data.canRegister).toBe(true);
		expect(data.today).toBe(buenosAiresToday());
		expect(data.reserved).toEqual({ [INSTALLMENT]: '30.00' });
		expect(data.payments.map((p: any) => p.id)).toEqual(['c']);
		expect(data.submitted).toBe(true);
		const readOnly = setup({
			permissions: ['bond.view_own', 'sale.view_own'],
			rpc: { portal_my_sale: [saleRow] }
		});
		const readOnlyData = await load({
			locals: readOnly.locals,
			params: { campaignId: CAMP, saleId: SALE },
			url: new URL('http://localhost/x')
		} as never);
		expect(readOnlyData.canRegister).toBe(false);
	});
});

describe('buenosAiresToday', () => {
	it('uses the Buenos Aires calendar day, not UTC', () => {
		expect(buenosAiresToday(new Date('2026-11-25T02:30:00Z'))).toBe('2026-11-24');
		expect(buenosAiresToday(new Date('2026-11-25T03:00:00Z'))).toBe('2026-11-25');
	});
});

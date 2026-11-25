import { describe, expect, it, vi } from 'vitest';
import {
	attachCollectorPayment,
	mapCollectorPaymentError,
	rejectCollectorPayment,
	submitCollectorPayment
} from './collector-payments';
import { SettlementServiceError } from './settlements';

const SALE = '11111111-1111-4111-8111-111111111111';
const INSTALLMENT = '22222222-2222-4222-8222-222222222222';
const PAYMENT = '33333333-3333-4333-8333-333333333333';
const SETTLEMENT = '44444444-4444-4444-8444-444444444444';
const client = (result: { data?: unknown; error?: { code?: string; message?: string } | null }) => {
	const rpc = vi.fn(async () => ({ data: result.data ?? null, error: result.error ?? null }));
	return { rpc, supabase: { rpc } as never };
};
const submit = {
	saleId: SALE,
	installmentId: INSTALLMENT,
	amount: '70.50',
	paymentMethod: 'cash' as const,
	paymentDate: '2026-11-20',
	note: ' En mano '
};
const ctx = (permissions: string[] | null) => ({ requestId: 'req', permissions });

describe('collector payments service', () => {
	it('submits one application with the amount, never a collector', async () => {
		const { rpc, supabase } = client({ data: PAYMENT });
		expect(await submitCollectorPayment(supabase, submit, ctx(['payment.create_own']))).toBe(
			PAYMENT
		);
		expect(rpc).toHaveBeenCalledWith('portal_payment_submit', {
			p_sale_id: SALE,
			p_amount: 70.5,
			p_payment_method: 'cash',
			p_applications: [{ installment_id: INSTALLMENT, amount_applied: 70.5 }],
			p_payment_date: '2026-11-20',
			p_request_id: 'req',
			p_note: 'En mano'
		});
		expect(JSON.stringify(rpc.mock.calls[0])).not.toContain('collector');
	});

	it('needs payment.create_own and fails closed without permissions', async () => {
		const { rpc, supabase } = client({});
		await expect(
			submitCollectorPayment(supabase, submit, ctx(['payment.create']))
		).rejects.toMatchObject({ kind: 'permission' });
		await expect(submitCollectorPayment(supabase, submit, ctx(null))).rejects.toMatchObject({
			kind: 'internal'
		});
		expect(rpc).not.toHaveBeenCalled();
	});

	it('validates before calling the database', async () => {
		const { rpc, supabase } = client({});
		const bads = [
			{ amount: '0' },
			{ amount: '1.005' },
			{ paymentMethod: 'check' },
			{ saleId: 'x' },
			{ paymentDate: 'ayer' },
			{ note: 'x'.repeat(501) }
		];
		for (const bad of bads) {
			await expect(
				submitCollectorPayment(
					supabase,
					{ ...submit, ...bad } as never,
					ctx(['payment.create_own'])
				)
			).rejects.toMatchObject({ kind: 'validation' });
		}
		expect(rpc).not.toHaveBeenCalled();
	});

	it('translates database errors to neutral Spanish', () => {
		const cases: [{ code: string; message: string }, string, string][] = [
			[
				{ code: '22023', message: 'payment date cannot be in the future' },
				'validation',
				'La fecha del cobro no puede ser futura.'
			],
			[
				{ code: '23514', message: 'payment applications exceed installment amount' },
				'validation',
				'El importe supera el saldo de la cuota, contando los cobros pendientes.'
			],
			[
				{ code: 'P0002', message: 'sale x not found' },
				'not_found',
				'No se encontró la venta o el cobro.'
			],
			[
				{ code: '42501', message: 'permission denied' },
				'permission',
				'No hay permiso para esta acción.'
			],
			[
				{ code: '55000', message: 'only a draft submitted by the collector can be included' },
				'conflict',
				'Este cobro ya fue procesado.'
			]
		];
		for (const [error, kind, message] of cases) {
			const mapped = mapCollectorPaymentError(error);
			expect(mapped).toBeInstanceOf(SettlementServiceError);
			expect(mapped).toMatchObject({ kind, message });
		}
		const unknown = mapCollectorPaymentError({ code: 'XX000', message: 'boom' });
		expect(unknown.kind).toBe('internal');
		expect(unknown.message).not.toContain('boom');
	});

	it('includes and rejects with the settlement permissions', async () => {
		const { rpc, supabase } = client({});
		const review = ['payment.create', 'settlement.update_open'];
		await attachCollectorPayment(
			supabase,
			{ settlementId: SETTLEMENT, paymentId: PAYMENT },
			ctx(review)
		);
		expect(rpc).toHaveBeenLastCalledWith('settlement_attach_collector_payment', {
			p_settlement_id: SETTLEMENT,
			p_payment_id: PAYMENT,
			p_request_id: 'req'
		});
		await rejectCollectorPayment(
			supabase,
			{ paymentId: PAYMENT, reason: ' No llegó ' },
			ctx(review)
		);
		expect(rpc).toHaveBeenLastCalledWith('settlement_reject_collector_payment', {
			p_payment_id: PAYMENT,
			p_reason: 'No llegó',
			p_request_id: 'req'
		});
		await expect(
			rejectCollectorPayment(supabase, { paymentId: PAYMENT, reason: ' ' }, ctx(review))
		).rejects.toMatchObject({ kind: 'validation' });
		for (const permissions of [
			['payment.create'],
			['settlement.update_open'],
			['payment.create_own']
		]) {
			await expect(
				attachCollectorPayment(
					supabase,
					{ settlementId: SETTLEMENT, paymentId: PAYMENT },
					ctx(permissions)
				)
			).rejects.toMatchObject({ kind: 'permission' });
			await expect(
				rejectCollectorPayment(supabase, { paymentId: PAYMENT, reason: 'x' }, ctx(permissions))
			).rejects.toMatchObject({ kind: 'permission' });
		}
		expect(rpc).toHaveBeenCalledTimes(2);
	});
});

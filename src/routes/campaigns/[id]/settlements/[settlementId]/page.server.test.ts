/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('$lib/server/repositories/campaigns', () => ({ getCampaignById: vi.fn() }));
vi.mock('$lib/server/repositories/settlements', () => ({
	getSettlement: vi.fn(),
	getSettlementTotals: vi.fn(),
	listSettlementPayments: vi.fn(),
	listCollectorPaymentCandidates: vi.fn()
}));
vi.mock('$lib/server/services/settlements', async (o) => ({
	...(await o<any>()),
	addPaymentToSettlement: vi.fn(),
	removePaymentFromSettlement: vi.fn(),
	closeSettlement: vi.fn()
}));
vi.mock('$lib/server/services/payment-corrections', async (o) => ({
	...(await o<any>()),
	annulPayment: vi.fn(),
	correctPaymentMethod: vi.fn(),
	reassociateTransfer: vi.fn()
}));
vi.mock('$lib/server/services/sale-corrections', async (o) => ({
	...(await o<any>()),
	correctSettlement: vi.fn()
}));
import { actions, load } from './+page.server';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import {
	getSettlement,
	getSettlementTotals,
	listCollectorPaymentCandidates,
	listSettlementPayments
} from '$lib/server/repositories/settlements';
import {
	addPaymentToSettlement,
	closeSettlement,
	removePaymentFromSettlement,
	SettlementServiceError
} from '$lib/server/services/settlements';
import {
	annulPayment,
	annulPaymentSchema,
	correctPaymentMethod,
	correctPaymentMethodSchema,
	reassociateTransfer,
	reassociateTransferSchema
} from '$lib/server/services/payment-corrections';
import { correctSettlement, correctSettlementSchema } from '$lib/server/services/sale-corrections';
import { CAMPAIGN_ID, makeLocals } from '../../../test-helpers';
const SETTLEMENT = 'd0000000-0000-0000-0000-000000000001',
	SALE = 'a0000000-0000-0000-0000-000000000001',
	INSTALLMENT = 'b0000000-0000-0000-0000-000000000001',
	url = `http://localhost/campaigns/${CAMPAIGN_ID}/settlements/${SETTLEMENT}`;
const totals = {
	totalCash: '1.00',
	totalTransfer: '2.00',
	totalAmount: '3.00',
	commissionAmount: '0.00',
	commissionPaidAmount: '0.00',
	netToFirefighters: '3.00',
	collectorCreditBalance: '0.00'
};
const settlement = (status = 'open') => ({
	id: SETTLEMENT,
	collectorId: 'c',
	status,
	totals,
	settlementNumber: 1,
	collectorName: 'Ana',
	openedAt: '2026-01-01',
	closedAt: null,
	notes: null
});
const run = async (
	action: keyof typeof actions,
	permissions: string[] | null,
	fields: Record<string, string> = {}
) => {
	const body = new FormData();
	Object.entries(fields).forEach(([k, v]) => body.append(k, v));
	return await actions[action]({
		locals: makeLocals({ permissions }),
		params: { id: CAMPAIGN_ID, settlementId: SETTLEMENT },
		url: new URL(url),
		request: new Request(url, { method: 'POST', body })
	} as never);
};
beforeEach(() => {
	vi.mocked(getCampaignById).mockResolvedValue({ data: { id: CAMPAIGN_ID }, error: null } as never);
	vi.mocked(getSettlement).mockResolvedValue({ data: settlement(), error: null } as never);
	vi.mocked(getSettlementTotals).mockResolvedValue({ data: totals, error: null } as never);
	vi.mocked(listSettlementPayments).mockResolvedValue({ data: [], error: null } as never);
	vi.mocked(listCollectorPaymentCandidates).mockResolvedValue({
		data: [{ id: INSTALLMENT, saleId: SALE, amount: '10.00' }],
		error: null
	} as never);
	for (const service of [
		annulPayment,
		correctPaymentMethod,
		reassociateTransfer,
		correctSettlement
	])
		vi.mocked(service).mockReset();
});
describe('settlement workspace', () => {
	it.each(['add', 'remove', 'close'] as const)(
		'returns 500 before authorization or work when permissions are unavailable: %s',
		async (action) => {
			expect(await run(action, null)).toMatchObject({
				status: 500,
				data: { form: action, message: 'Could not load permissions.' }
			});
			expect(getSettlement).not.toHaveBeenCalled();
			expect(addPaymentToSettlement).not.toHaveBeenCalled();
			expect(removePaymentFromSettlement).not.toHaveBeenCalled();
			expect(closeSettlement).not.toHaveBeenCalled();
		}
	);
	it('validates the remaining installment balance rather than the original amount', async () => {
		vi.mocked(listCollectorPaymentCandidates).mockResolvedValueOnce({
			data: [{ id: INSTALLMENT, saleId: SALE, amount: '2.50' }],
			error: null
		} as never);
		expect(
			await run('add', ['campaign.view', 'settlement.update_open', 'payment.create'], {
				saleId: SALE,
				installmentId: INSTALLMENT,
				[`amount-${INSTALLMENT}`]: '2,51',
				paymentMethod: 'cash'
			})
		).toMatchObject({
			status: 400,
			data: {
				errors: {
					[`amount-${INSTALLMENT}`]: ['The amount cannot exceed the installment balance.']
				}
			}
		});
		expect(addPaymentToSettlement).not.toHaveBeenCalled();
	});
	it('counts removal reasons in Unicode code points at the database limit', async () => {
		const permissions = ['campaign.view', 'settlement.update_open'];
		expect(
			await run('remove', permissions, {
				paymentId: SETTLEMENT,
				reason: '😀'.repeat(1000)
			})
		).toMatchObject({ success: true });
		expect(removePaymentFromSettlement).toHaveBeenCalledTimes(1);
		expect(
			await run('remove', permissions, {
				paymentId: SETTLEMENT,
				reason: '😀'.repeat(1001)
			})
		).toMatchObject({ status: 400 });
		expect(removePaymentFromSettlement).toHaveBeenCalledTimes(1);
	});
	it('returns 404 for malformed and missing settlements', async () => {
		await expect(
			load({
				locals: makeLocals({ permissions: ['campaign.view', 'settlement.view'] }),
				params: { id: CAMPAIGN_ID, settlementId: 'bad' },
				url: new URL(url)
			} as never)
		).rejects.toMatchObject({ status: 404 });
		vi.mocked(getSettlement).mockResolvedValueOnce({ data: null, error: null } as never);
		await expect(
			load({
				locals: makeLocals({ permissions: ['campaign.view', 'settlement.view'] }),
				params: { id: CAMPAIGN_ID, settlementId: SETTLEMENT },
				url: new URL(url)
			} as never)
		).rejects.toMatchObject({ status: 404 });
	});
	it('uses RPC totals while open and stored totals plus live balance while closed', async () => {
		await load({
			locals: makeLocals({ permissions: ['campaign.view', 'settlement.view'] }),
			params: { id: CAMPAIGN_ID, settlementId: SETTLEMENT },
			url: new URL(url)
		} as never);
		expect(getSettlementTotals).toHaveBeenCalled();
		vi.mocked(getSettlement).mockResolvedValueOnce({
			data: settlement('closed'),
			error: null
		} as never);
		const out: any = await load({
			locals: makeLocals({ permissions: ['campaign.view', 'settlement.view'] }),
			params: { id: CAMPAIGN_ID, settlementId: SETTLEMENT },
			url: new URL(url)
		} as never);
		expect(out.totals).toEqual(totals);
		expect(getSettlementTotals).toHaveBeenCalledTimes(2);
	});
	it('denies each action without its permission', async () => {
		expect(await run('add', ['campaign.view'])).toMatchObject({ status: 403 });
		expect(await run('remove', ['campaign.view'])).toMatchObject({ status: 403 });
		expect(await run('close', ['campaign.view'])).toMatchObject({ status: 403 });
	});
	it.each([
		'annulPayment',
		'correctPaymentMethod',
		'reassociateTransfer',
		'correctSettlement'
	] as const)('%s fails closed at 500 and denies at 403 before service work', async (action) => {
		expect(await run(action, null)).toMatchObject({ status: 500 });
		expect(await run(action, ['campaign.view'])).toMatchObject({ status: 403 });
		expect(annulPayment).not.toHaveBeenCalled();
		expect(correctPaymentMethod).not.toHaveBeenCalled();
		expect(reassociateTransfer).not.toHaveBeenCalled();
		expect(correctSettlement).not.toHaveBeenCalled();
	});
	it.each([
		['annulPayment', annulPayment, annulPaymentSchema, { paymentId: SETTLEMENT, reason: 'Reason' }],
		[
			'correctPaymentMethod',
			correctPaymentMethod,
			correctPaymentMethodSchema,
			{ paymentId: SETTLEMENT, newMethod: 'transfer', reason: 'Reason' }
		],
		[
			'reassociateTransfer',
			reassociateTransfer,
			reassociateTransferSchema,
			{
				paymentId: SETTLEMENT,
				newSaleId: SALE,
				installmentId: INSTALLMENT,
				amountApplied: '3.00',
				reason: 'Reason'
			}
		],
		[
			'correctSettlement',
			correctSettlement,
			correctSettlementSchema,
			{ commissionDelta: '1.00', cashRetainedDelta: '0.00', reason: 'Reason' }
		]
	] as const)(
		'%s validates, maps 400/404/409, and succeeds',
		async (action, service, schema, valid) => {
			vi.mocked(service).mockImplementation(async (_client, input) => {
				const parsed = schema.safeParse(input);
				if (!parsed.success) throw new SettlementServiceError('validation', 'Invalid correction.');
				return null;
			});
			const permission =
				action === 'correctSettlement'
					? ['campaign.view', 'settlement.correct']
					: ['campaign.view', 'payment.annul'];
			for (const fields of [
				{ ...valid, reason: '' },
				{ ...valid, reason: '😀'.repeat(1001) },
				action === 'correctSettlement'
					? { ...valid, commissionDelta: 'bad' }
					: { ...valid, paymentId: 'bad' }
			])
				expect(await run(action, permission, fields)).toMatchObject({ status: 400 });
			for (const [kind, status] of [
				['conflict', 409],
				['validation', 400],
				['not_found', 404]
			] as const) {
				vi.mocked(service).mockRejectedValueOnce(new SettlementServiceError(kind, kind));
				expect(await run(action, permission, valid)).toMatchObject({ status });
			}
			vi.mocked(service).mockResolvedValueOnce(null);
			expect(await run(action, permission, valid)).toMatchObject({ success: true });
		}
	);
	it.each(['annulPayment', 'correctPaymentMethod', 'reassociateTransfer'] as const)(
		'%s rejects a settlement outside the route campaign before service work',
		async (action) => {
			vi.mocked(getSettlement).mockResolvedValueOnce({ data: null, error: null } as never);
			const fields: Record<string, string> =
				action === 'annulPayment'
					? { paymentId: SETTLEMENT, reason: 'Reason' }
					: action === 'correctPaymentMethod'
						? { paymentId: SETTLEMENT, newMethod: 'transfer', reason: 'Reason' }
						: {
								paymentId: SETTLEMENT,
								newSaleId: SALE,
								installmentId: INSTALLMENT,
								amountApplied: '3.00',
								reason: 'Reason'
							};
			expect(await run(action, ['campaign.view', 'payment.annul'], fields)).toMatchObject({
				status: 404
			});
			expect(annulPayment).not.toHaveBeenCalled();
			expect(correctPaymentMethod).not.toHaveBeenCalled();
			expect(reassociateTransfer).not.toHaveBeenCalled();
		}
	);
	it('preserves the moved-payment guard message', async () => {
		vi.mocked(correctPaymentMethod).mockRejectedValueOnce(
			new SettlementServiceError(
				'conflict',
				'This payment was already moved by a correction and cannot be corrected again.'
			)
		);
		expect(
			await run('correctPaymentMethod', ['campaign.view', 'payment.annul'], {
				paymentId: SETTLEMENT,
				newMethod: 'transfer',
				reason: 'Reason'
			})
		).toMatchObject({
			status: 409,
			data: {
				message: 'This payment was already moved by a correction and cannot be corrected again.'
			}
		});
	});
	it('requires payment.create in addition to settlement.update_open for adds', async () => {
		expect(await run('add', ['campaign.view', 'settlement.update_open'])).toMatchObject({
			status: 403
		});
	});
	it('validates adds and sums cents exactly', async () => {
		const p = ['campaign.view', 'settlement.update_open', 'payment.create'];
		expect(await run('add', p, { saleId: SALE, paymentMethod: 'cash' })).toMatchObject({
			status: 400
		});
		expect(
			await run('add', p, {
				saleId: SALE,
				installmentId: INSTALLMENT,
				[`amount-${INSTALLMENT}`]: 'no',
				paymentMethod: 'cash'
			})
		).toMatchObject({ status: 400 });
		expect(
			await run('add', p, {
				saleId: SALE,
				installmentId: INSTALLMENT,
				[`amount-${INSTALLMENT}`]: '11',
				paymentMethod: 'cash'
			})
		).toMatchObject({ status: 400 });
		expect(
			await run('add', p, {
				saleId: SALE,
				installmentId: INSTALLMENT,
				[`amount-${INSTALLMENT}`]: '1',
				paymentMethod: 'wire'
			})
		).toMatchObject({ status: 400 });
		await run('add', p, {
			saleId: SALE,
			installmentId: INSTALLMENT,
			[`amount-${INSTALLMENT}`]: '0,10',
			paymentMethod: 'cash'
		});
		expect(addPaymentToSettlement).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ amount: '0.10' }),
			expect.anything()
		);
	});
	it('validates removal and maps service errors', async () => {
		expect(
			await run('remove', ['campaign.view', 'settlement.update_open'], { paymentId: SETTLEMENT })
		).toMatchObject({ status: 400 });
		expect(
			await run('remove', ['campaign.view', 'settlement.update_open'], {
				paymentId: SETTLEMENT,
				reason: 'x'.repeat(2001)
			})
		).toMatchObject({ status: 400 });
		vi.mocked(removePaymentFromSettlement).mockRejectedValueOnce(
			new SettlementServiceError('conflict', 'No.')
		);
		expect(
			await run('remove', ['campaign.view', 'settlement.update_open'], {
				paymentId: SETTLEMENT,
				reason: 'why'
			})
		).toMatchObject({ status: 409 });
		vi.mocked(closeSettlement).mockRejectedValueOnce(new SettlementServiceError('conflict', 'No.'));
		expect(await run('close', ['campaign.view', 'settlement.close'])).toMatchObject({
			status: 409
		});
	});
	it('maps add service errors', async () => {
		vi.mocked(addPaymentToSettlement).mockRejectedValueOnce(
			new SettlementServiceError('conflict', 'No.')
		);
		expect(
			await run('add', ['campaign.view', 'settlement.update_open', 'payment.create'], {
				saleId: SALE,
				installmentId: INSTALLMENT,
				[`amount-${INSTALLMENT}`]: '1',
				paymentMethod: 'cash'
			})
		).toMatchObject({ status: 409 });
	});
});

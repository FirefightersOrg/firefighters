/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('$lib/server/repositories/campaigns', () => ({ getCampaignById: vi.fn() }));
vi.mock('$lib/server/repositories/sales', () => ({ getSaleDetail: vi.fn() }));
vi.mock('$lib/server/repositories/parties', () => ({
	listBuyers: vi.fn(),
	listActiveCollectorOptions: vi.fn()
}));
vi.mock('$lib/server/services/sale-corrections', async (original) => ({
	...(await original<typeof import('$lib/server/services/sale-corrections')>()),
	correctSaleBuyer: vi.fn(),
	correctSaleCollector: vi.fn()
}));
import { actions, load } from './+page.server';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { getSaleDetail } from '$lib/server/repositories/sales';
import { listActiveCollectorOptions, listBuyers } from '$lib/server/repositories/parties';
import {
	correctSaleBuyer,
	correctSaleBuyerSchema,
	correctSaleCollector,
	correctSaleCollectorSchema,
	SaleCorrectionServiceError
} from '$lib/server/services/sale-corrections';
import { CAMPAIGN_ID, makeLocals } from '../../../test-helpers';
const SALE = 'a0000000-0000-0000-0000-000000000009',
	url = `http://localhost/campaigns/${CAMPAIGN_ID}/sales/${SALE}`;
const event = (permissions: string[] | null, saleId = SALE) => ({
	locals: makeLocals({ permissions }),
	params: { id: CAMPAIGN_ID, saleId },
	url: new URL(url)
});
beforeEach(() => {
	vi.mocked(getCampaignById).mockResolvedValue({ data: { id: CAMPAIGN_ID }, error: null } as never);
	vi.mocked(getSaleDetail).mockResolvedValue({
		data: {
			sale: { status: 'active' },
			plan: { status: 'active' },
			installments: [
				{ installmentNumber: 1, dueDate: '2020-01-01', amount: '10.00', status: 'pending' }
			]
		},
		error: null
	} as never);
	vi.mocked(listBuyers).mockResolvedValue({ data: { items: [] }, error: null } as never);
	vi.mocked(listActiveCollectorOptions).mockResolvedValue({ data: [], error: null });
	vi.mocked(correctSaleBuyer).mockReset();
	vi.mocked(correctSaleCollector).mockReset();
});
describe('sale detail', () => {
	it('requires sale or bond viewing', async () => {
		await expect(load(event(['campaign.view']) as never)).rejects.toMatchObject({ status: 403 });
	});
	it('returns 500 when permissions are unavailable', async () => {
		await expect(load(event(null as never) as never)).rejects.toMatchObject({ status: 500 });
	});
	it('returns 404 for malformed, missing, or out-of-campaign sales', async () => {
		await expect(load(event(['campaign.view', 'sale.view'], 'bad') as never)).rejects.toMatchObject(
			{ status: 404 }
		);
		vi.mocked(getSaleDetail).mockResolvedValueOnce({ data: null, error: null } as never);
		await expect(load(event(['campaign.view', 'sale.view']) as never)).rejects.toMatchObject({
			status: 404
		});
	});
	it('includes installments and computed financial status', async () => {
		const out = (await load(event(['campaign.view', 'sale.view']) as never)) as any;
		expect(out.sale.installments).toHaveLength(1);
		expect(out.financialStatus).toBe('overdue');
	});
});

const run = async (
	action: 'correctBuyer' | 'correctCollector',
	permissions: string[] | null,
	fields: Record<string, string>
) => {
	const body = new FormData();
	for (const [key, value] of Object.entries(fields)) body.set(key, value);
	return actions[action]({
		...event(permissions),
		request: new Request(url, { method: 'POST', body })
	} as never);
};
const BUYER = 'b0000000-0000-4000-8000-000000000001';
const COLLECTOR = 'c0000000-0000-4000-8000-000000000001';

describe('sale correction actions', () => {
	it.each(['correctBuyer', 'correctCollector'] as const)(
		'%s fails closed at 500 and denies missing permission at 403 before service work',
		async (action) => {
			expect(await run(action, null, {})).toMatchObject({ status: 500 });
			expect(await run(action, ['campaign.view'], {})).toMatchObject({ status: 403 });
			expect(correctSaleBuyer).not.toHaveBeenCalled();
			expect(correctSaleCollector).not.toHaveBeenCalled();
		}
	);
	it.each([
		['correctBuyer', correctSaleBuyer, correctSaleBuyerSchema, { newBuyerId: BUYER }],
		[
			'correctCollector',
			correctSaleCollector,
			correctSaleCollectorSchema,
			{ newCollectorId: COLLECTOR }
		]
	] as const)(
		'%s validates ids and 1000-code-point reasons, maps service errors, and succeeds',
		async (action, service, schema, target) => {
			vi.mocked(service).mockImplementation(async (_client, input) => {
				const parsed = schema.safeParse(input);
				if (!parsed.success)
					throw new SaleCorrectionServiceError('validation', 'Invalid correction.');
				return null;
			});
			for (const fields of [
				{ ...target, reason: '' },
				{ ...target, reason: '😀'.repeat(1001) },
				{ ...target, [Object.keys(target)[0]]: 'bad', reason: 'Reason' }
			])
				expect(await run(action, ['campaign.view', 'sale.correct'], fields)).toMatchObject({
					status: 400
				});
			for (const [kind, status] of [
				['conflict', 409],
				['validation', 400],
				['not_found', 404]
			] as const) {
				vi.mocked(service).mockRejectedValueOnce(new SaleCorrectionServiceError(kind, kind));
				expect(
					await run(action, ['campaign.view', 'sale.correct'], { ...target, reason: 'Reason' })
				).toMatchObject({ status });
			}
			vi.mocked(service).mockResolvedValueOnce(null);
			expect(
				await run(action, ['campaign.view', 'sale.correct'], { ...target, reason: 'Reason' })
			).toMatchObject({ success: true });
		}
	);
});

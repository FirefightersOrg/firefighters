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
vi.mock('$lib/server/services/sale-uncollectible', () => ({
	markSaleUncollectible: vi.fn(),
	revertSaleUncollectible: vi.fn()
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
import {
	markSaleUncollectible,
	revertSaleUncollectible
} from '$lib/server/services/sale-uncollectible';
import { SaleServiceError } from '$lib/server/services/sales';
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
			],
			uncollectible: null
		},
		error: null
	} as never);
	vi.mocked(listBuyers).mockResolvedValue({ data: { items: [] }, error: null } as never);
	vi.mocked(listActiveCollectorOptions).mockResolvedValue({ data: [], error: null });
	vi.mocked(correctSaleBuyer).mockReset();
	vi.mocked(correctSaleCollector).mockReset();
	vi.mocked(markSaleUncollectible).mockReset();
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
	action: 'correctBuyer' | 'correctCollector' | 'markUncollectible' | 'revertUncollectible',
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
	it('exposes the buyers total so the selector can warn when it is truncated', async () => {
		vi.mocked(listBuyers).mockResolvedValueOnce({
			data: { items: [{ id: BUYER, firstName: 'Ana' }], total: 750 },
			error: null
		} as never);
		const data = (await load(event(['campaign.view', 'sale.view', 'sale.correct']) as never)) as {
			correction: { buyers: unknown[]; buyersTotal: number };
		};
		expect(data.correction.buyersTotal).toBe(750);
		expect(data.correction.buyers).toHaveLength(1);
	});
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
					throw new SaleCorrectionServiceError('validation', 'Corrección inválida.');
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
	it.each(['correctBuyer', 'correctCollector'] as const)(
		'%s rejects a sale outside the route campaign before service work',
		async (action) => {
			vi.mocked(getSaleDetail).mockResolvedValueOnce({ data: null, error: null } as never);
			expect(
				await run(action, ['campaign.view', 'sale.correct'], {
					...(action === 'correctBuyer' ? { newBuyerId: BUYER } : { newCollectorId: COLLECTOR }),
					reason: 'Reason'
				})
			).toMatchObject({ status: 404 });
			expect(correctSaleBuyer).not.toHaveBeenCalled();
			expect(correctSaleCollector).not.toHaveBeenCalled();
		}
	);
});

describe('mark uncollectible (SAN-106)', () => {
	const marked = {
		sale: { status: 'active' },
		plan: { status: 'active' },
		installments: [],
		uncollectible: { markedAt: '2026-11-25T12:00:00Z', reason: 'Se mudó' }
	};
	it('offers the form only with sale.mark_uncollectible, on an active unmarked sale', async () => {
		const loadWith = async (permissions: string[]) =>
			((await load(event(permissions) as never)) as any).canMarkUncollectible;
		expect(await loadWith(['campaign.view', 'sale.view'])).toBe(false);
		expect(await loadWith(['campaign.view', 'sale.view', 'sale.mark_uncollectible'])).toBe(true);
		vi.mocked(getSaleDetail).mockResolvedValueOnce({ data: marked, error: null } as never);
		expect(await loadWith(['campaign.view', 'sale.view', 'sale.mark_uncollectible'])).toBe(false);
		vi.mocked(getSaleDetail).mockResolvedValueOnce({
			data: { ...marked, sale: { status: 'annulled' }, uncollectible: null },
			error: null
		} as never);
		expect(await loadWith(['campaign.view', 'sale.view', 'sale.mark_uncollectible'])).toBe(false);
	});
	it('computes the uncollectible financial status from the mark', async () => {
		vi.mocked(getSaleDetail).mockResolvedValueOnce({ data: marked, error: null } as never);
		const out = (await load(event(['campaign.view', 'sale.view']) as never)) as any;
		expect(out.financialStatus).toBe('uncollectible');
	});
	it('fails closed at 500 and denies missing permission at 403 before service work', async () => {
		expect(await run('markUncollectible', null, { reason: 'x' })).toMatchObject({ status: 500 });
		expect(
			await run('markUncollectible', ['campaign.view', 'sale.view'], { reason: 'x' })
		).toMatchObject({ status: 403 });
		expect(markSaleUncollectible).not.toHaveBeenCalled();
	});
	it('passes the trimmed reason and maps service errors to the reason field', async () => {
		const perms = ['campaign.view', 'sale.view', 'sale.mark_uncollectible'];
		vi.mocked(markSaleUncollectible).mockResolvedValueOnce();
		expect(await run('markUncollectible', perms, { reason: '  Se mudó  ' })).toMatchObject({
			form: 'markUncollectible',
			success: true,
			message: 'Venta marcada como incobrable.'
		});
		expect(markSaleUncollectible).toHaveBeenLastCalledWith(
			expect.anything(),
			{ saleId: SALE, reason: 'Se mudó' },
			expect.objectContaining({ permissions: perms })
		);
		vi.mocked(markSaleUncollectible).mockRejectedValueOnce(
			new SaleServiceError('validation', 'Ingresar el motivo.', { field: 'reason' })
		);
		expect(await run('markUncollectible', perms, { reason: '' })).toMatchObject({
			status: 400,
			data: { errors: { reason: ['Ingresar el motivo.'] }, values: { reason: '' } }
		});
		vi.mocked(markSaleUncollectible).mockRejectedValueOnce(
			new SaleServiceError('conflict', 'La venta ya está marcada como incobrable.')
		);
		expect(await run('markUncollectible', perms, { reason: 'Otra vez' })).toMatchObject({
			status: 409,
			data: { message: 'La venta ya está marcada como incobrable.' }
		});
		vi.mocked(markSaleUncollectible).mockRejectedValueOnce(new Error('boom'));
		expect(await run('markUncollectible', perms, { reason: 'x' })).toMatchObject({ status: 500 });
	});
});

describe('revert uncollectible (follow-up of SAN-106)', () => {
	it('offers the revert only to sale.revert_uncollectible on a marked active sale', async () => {
		const marked = {
			sale: { status: 'active' },
			plan: { status: 'active' },
			installments: [],
			uncollectible: { markedAt: '2026-11-25T12:00:00Z', reason: 'Se mudó' }
		};
		vi.mocked(getSaleDetail).mockResolvedValueOnce({ data: marked, error: null } as never);
		const admin = (await load(
			event(['campaign.view', 'sale.view', 'sale.revert_uncollectible']) as never
		)) as any;
		expect(admin.canRevertUncollectible).toBe(true);
		const unmarked = (await load(
			event(['campaign.view', 'sale.view', 'sale.revert_uncollectible']) as never
		)) as any;
		expect(unmarked.canRevertUncollectible).toBe(false);
	});
	it('denies without the permission and reverts with the trimmed reason', async () => {
		vi.mocked(revertSaleUncollectible).mockReset();
		expect(
			await run('revertUncollectible', ['campaign.view', 'sale.mark_uncollectible'], {
				reason: 'x'
			})
		).toMatchObject({ status: 403 });
		expect(revertSaleUncollectible).not.toHaveBeenCalled();
		vi.mocked(revertSaleUncollectible).mockResolvedValueOnce();
		expect(
			await run('revertUncollectible', ['campaign.view', 'sale.revert_uncollectible'], {
				reason: '  Apareció  '
			})
		).toMatchObject({ success: true, message: 'Se revirtió la marca de incobrable.' });
		expect(revertSaleUncollectible).toHaveBeenLastCalledWith(
			expect.anything(),
			{ saleId: SALE, reason: 'Apareció' },
			expect.anything()
		);
	});
});

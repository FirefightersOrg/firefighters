import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';
import { mapCampaignRow } from '$lib/server/repositories/campaigns';
import { CAMPAIGN_ID, campaignRow } from '../../../test-helpers';

/**
 * Buyer record (UX plan PR 15): the sentence, the way to call, each bond with its debt, the unpaid
 * installments and the collapsed groups. The `update` action is covered by `page.server.test.ts`.
 */
const BUYER_ID = 'b0000000-0000-0000-0000-000000000002';
const TODAY = '2026-11-26';
const bondId = 'b0000000-0000-0000-0000-000000000001';

const sale = (id: string, base: number, extra: Record<string, unknown> = {}) => ({
	sale: {
		id,
		status: 'active',
		collectorId: 'c0000000-0000-0000-0000-000000000001',
		soldAt: '2026-09-12T15:00:00Z',
		totalAmount: '30000.00',
		...((extra.sale as object) ?? {})
	},
	bondId,
	bondNumbers: [base],
	bondNumberPairs: [{ base, associated: base + 5000 }],
	financialStatus: extra.financialStatus ?? 'partial_payments'
});
const installment = (number: number, dueDate: string, applied = '0.00', status = 'pending') => ({
	number,
	dueDate,
	amount: '10000.00',
	applied,
	status
});
const plan = [
	installment(1, '2026-10-10', '10000.00', 'paid'),
	installment(2, '2026-11-10'),
	installment(3, '2026-12-10')
];

function page(extra: Record<string, unknown> = {}, form: unknown = null) {
	const { buyer, ...rest } = extra as { buyer?: Record<string, unknown> };
	return render(Page, {
		props: {
			data: {
				campaign: mapCampaignRow(campaignRow()),
				buyer: {
					id: BUYER_ID,
					type: 'individual',
					firstName: 'Ada',
					lastName: 'Lovelace',
					businessName: null,
					documentNumber: '123',
					taxId: null,
					phone: '2364 55-0100',
					address: 'Main Street 1',
					usualCollectorId: null,
					notes: 'Call after noon',
					updatedAt: '',
					...buyer
				},
				today: TODAY,
				collector: null,
				collectors: [],
				usualCollectorNotVisible: false,
				canViewCollectors: true,
				canViewPayments: true,
				canPay: false,
				canManage: false,
				canViewPrizes: true,
				sales: [],
				saleInstallments: {},
				saleCollectors: {},
				installments: [],
				campaignBonds: [],
				historicalBonds: [],
				prizes: [],
				audit: null,
				...rest
			},
			form,
			params: { id: CAMPAIGN_ID, buyerId: BUYER_ID }
		} as never
	}).body.replace(/\u00a0/g, ' ');
}
/** The text of a piece of the page, without tags, comments or runs of spaces. */
const textOf = (html: string) =>
	html
		.replace(/<!--.*?-->/g, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.replace(/ \./g, '.')
		.trim();
const sentence = (body: string) =>
	textOf(/data-buyer-sentence[^>]*>([\s\S]*?)<\/p>/.exec(body)![1]);
const oneSale = {
	sales: [sale('s1', 190)],
	saleInstallments: { s1: plan },
	saleCollectors: { s1: 'Héctor Acosta' }
};

describe('buyer record: the first screen', () => {
	it('says the bond, what is owed and who collects it, with the next step', () => {
		const body = page({ ...oneSale, canPay: true });
		expect(body).toContain('Lovelace, Ada');
		expect(sentence(body)).toBe(
			'Ada Lovelace compró el bono 0190 en esta campaña. Debe $ 20.000, de los cuales $ 10.000 están vencidos. Lo cobra Héctor Acosta.'
		);
		expect(body).toMatch(/data-buyer-lead[\s\S]*Falta cobrar[\s\S]*\$ 20\.000/);
		expect(body).toContain(
			`href="/campaigns/${CAMPAIGN_ID}/settlements/new?intent=payment&amp;collector=c0000000-0000-0000-0000-000000000001"`
		);
		expect(body).toContain('Registrar pago');
		// The collector is a link when the role may open collectors.
		expect(body).toContain(
			`href="/campaigns/${CAMPAIGN_ID}/collectors/c0000000-0000-0000-0000-000000000001"`
		);
	});

	it('shows how to call the buyer and who the buyer is', () => {
		const body = page({
			collector: { id: 'c0000000-0000-0000-0000-000000000009', displayName: 'Jorge Medina' }
		});
		expect(body).toContain('href="tel:2364550100"');
		expect(body).toContain('Llamar al 2364 55-0100');
		const facts = textOf(/data-buyer-facts[^>]*>([\s\S]*?)<\/dl>/.exec(body)![1]);
		expect(facts).toBe(
			'Documento 123 Cobrador habitual Jorge Medina Domicilio Main Street 1 Notas Call after noon'
		);
		expect(body).toContain(
			`href="/campaigns/${CAMPAIGN_ID}/collectors/c0000000-0000-0000-0000-000000000009"`
		);
		// A business is identified by its tax id.
		const business = page({
			buyer: { type: 'business', businessName: 'Acme SA', taxId: '20-123', documentNumber: null }
		});
		expect(business).toMatch(/<dt[^>]*>\s*CUIT\s*<\/dt>\s*<dd[^>]*>20-123/);
		expect(sentence(business)).toBe('Acme SA no compró bonos en esta campaña.');
	});

	it('leaves out what the buyer does not have', () => {
		const body = page({
			buyer: { phone: null, documentNumber: null, address: null, notes: null }
		});
		expect(body).not.toContain('tel:');
		expect(body).not.toContain('data-buyer-facts');
		expect(body).not.toContain('data-buyer-lead');
		expect(body).not.toContain('Bonos comprados');
		expect(body).not.toContain('Cuotas por cobrar');
	});

	it('offers nothing the role may not do, and no link it cannot open', () => {
		const body = page({ ...oneSale, canViewCollectors: false });
		expect(body).not.toContain('Registrar pago');
		expect(body).not.toContain('/collectors/');
		expect(sentence(body)).toContain('Lo cobra Héctor Acosta.');
		// A collector the role cannot read is not named at all.
		const unnamed = page({ ...oneSale, saleCollectors: {} });
		expect(sentence(unnamed)).toBe(
			'Ada Lovelace compró el bono 0190 en esta campaña. Debe $ 20.000, de los cuales $ 10.000 están vencidos.'
		);
		expect(unnamed).not.toMatch(/Unknown|Sin acceso/);
	});

	it('leads with «Pagado» once nothing is owed', () => {
		const body = page({
			sales: [sale('s1', 190, { sale: { totalAmount: '10000.00' } })],
			saleInstallments: { s1: [installment(1, '2026-10-10', '10000.00', 'paid')] },
			saleCollectors: { s1: 'Héctor Acosta' },
			canPay: true
		});
		expect(body).toMatch(/data-buyer-lead[\s\S]*Pagado[\s\S]*\$ 10\.000/);
		expect(sentence(body)).toBe(
			'Ada Lovelace compró el bono 0190 en esta campaña. No debe nada. Lo cobró Héctor Acosta.'
		);
		expect(body).not.toContain('Registrar pago');
		expect(body).not.toContain('Cuotas por cobrar');
	});
});

describe('buyer record: bonds and installments', () => {
	it('says each bond with the words of the sale record and links its sale', () => {
		const body = page(oneSale);
		expect(body).toMatch(/Bonos comprados\s*<span[^>]*>1<\/span>/);
		const row = textOf(/data-sale-row[^>]*>([\s\S]*?)<\/li>/.exec(body)![1]);
		expect(row).toBe(
			'Venta del bono 0190 / 5190 $ 20.000 Lo compró el 12/09/2026 en 3 cuotas, por $ 30.000. Pagó 1 cuota y debe $ 20.000, de los cuales $ 10.000 están vencidos.'
		);
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/sales/s1"`);
		expect(body).not.toContain('Sin permiso para ver los pagos');
	});

	it('lists the unpaid installments by due date, with what each still owes', () => {
		const body = page({
			sales: [sale('s1', 190), sale('s2', 24)],
			saleInstallments: {
				s1: plan,
				s2: [installment(1, '2026-11-20', '4000.00'), installment(2, '2026-12-20')]
			},
			saleCollectors: { s1: 'Héctor Acosta', s2: 'Héctor Acosta' }
		});
		expect(sentence(body)).toBe(
			'Ada Lovelace compró 2 bonos en esta campaña. Debe $ 36.000, de los cuales $ 16.000 están vencidos. Los cobra Héctor Acosta.'
		);
		expect(body).toMatch(/Cuotas por cobrar\s*<span[^>]*>4<\/span>/);
		const rows = body
			.split('data-pending-installment')
			.slice(1)
			.map((row) => textOf(row.slice(row.indexOf('>') + 1, row.indexOf('</li>'))));
		expect(rows).toEqual([
			'0190 Cuota 2 Venció el 10/11/2026 Vencida $ 10.000',
			'0024 Cuota 1 Venció el 20/11/2026 Vencida pago parcial $ 6.000',
			'0190 Cuota 3 Vence el 10/12/2026 $ 10.000',
			'0024 Cuota 2 Vence el 20/12/2026 $ 10.000'
		]);
	});

	it('names the collector on each bond when they are collected by more than one', () => {
		const body = page({
			sales: [
				sale('s1', 190),
				sale('s2', 24, { sale: { collectorId: 'c0000000-0000-0000-0000-000000000002' } })
			],
			saleInstallments: { s1: plan, s2: plan },
			saleCollectors: { s1: 'Héctor Acosta', s2: 'Lucía Fernández' },
			canPay: true
		});
		expect(sentence(body)).not.toContain('cobra');
		expect(textOf(body)).toContain('Lo cobra Héctor Acosta.');
		expect(textOf(body)).toContain('Lo cobra Lucía Fernández.');
		// Two collectors are owed: the payment is registered from each sale.
		expect(body).not.toContain('Registrar pago');
	});

	it('marks a sale that is paid, given up, annulled or corrected', () => {
		const body = page({
			sales: [
				sale('s1', 190, { sale: { totalAmount: '10000.00' } }),
				sale('s2', 24, { financialStatus: 'uncollectible' }),
				sale('s3', 30, { sale: { status: 'annulled' } }),
				sale('s4', 31, { sale: { status: 'corrected' } })
			],
			saleInstallments: {
				s1: [installment(1, '2026-10-10', '10000.00', 'paid')],
				s2: plan
			}
		});
		const rows = body
			.split('data-sale-row')
			.slice(1)
			.map((row) => textOf(row.slice(row.indexOf('>') + 1, row.indexOf('</li>'))));
		expect(rows[0]).toContain('Pagado');
		expect(rows[0]).toContain('Está pagado.');
		expect(rows[1]).toContain('Incobrable');
		expect(rows[1]).toContain('Se dio por incobrable: quedaron $ 20.000 sin cobrar.');
		expect(rows[2]).toContain('Venta anulada');
		expect(rows[2]).toContain('La venta fue anulada: no se cobra.');
		expect(rows[3]).toContain('Venta corregida');
		// Two bonds are the buyer's; what was given up is not left to collect.
		expect(body).toMatch(/Bonos comprados\s*<span[^>]*>2<\/span>/);
		expect(sentence(body)).toBe(
			'Ada Lovelace compró 2 bonos en esta campaña. $ 20.000 se dieron por incobrables.'
		);
		expect(body).not.toContain('data-buyer-lead');
		expect(body).not.toContain('Cuotas por cobrar');
	});

	it('shows the first 10 sales and collapses the rest', () => {
		const sales = Array.from({ length: 12 }, (_, i) => sale(`s${i}`, 100 + i));
		const body = page({
			sales,
			saleInstallments: Object.fromEntries(sales.map((item) => [item.sale.id, plan]))
		});
		const [shown, rest] = body.split('Ver las otras 2 ventas');
		expect(shown.match(/data-sale-row/g)).toHaveLength(10);
		expect(rest.match(/data-sale-row/g)).toHaveLength(2);
		// 24 unpaid installments: 10 shown, 14 collapsed.
		expect(body).toContain('Ver las otras 14 cuotas');
	});

	it('says so when the role cannot read payments, or a sale was not read in full', () => {
		const body = page({ ...oneSale, canViewPayments: false });
		expect(textOf(body)).toContain(
			'Sin permiso para ver los pagos: una cuota con un pago parcial figura por su importe completo.'
		);
		const partial = page({
			sales: [sale('s1', 190), sale('s2', 24)],
			saleInstallments: { s1: plan }
		});
		expect(sentence(partial)).toContain('Esta cuenta no incluye sus ventas más antiguas.');
	});

	it('lists a bond that is the buyer’s without a sale to show', () => {
		const body = page({
			campaignBonds: [
				{
					id: bondId,
					campaignId: CAMPAIGN_ID,
					campaignName: 'Campaign',
					campaignNumberDigits: 4,
					baseNumbers: [68]
				}
			]
		});
		expect(body).toContain('0068');
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/${bondId}"`);
	});
});

describe('buyer record: prizes, data and history', () => {
	it('renders prizes and converts a UTC instant near midnight to Buenos Aires', () => {
		const body = page({
			prizes: [
				{
					id: 'prize',
					drawId: 'draw',
					drawName: 'December',
					name: 'Bike',
					position: 1,
					status: 'delivered',
					deliveredAt: '2026-11-20T02:30:00+00:00'
				},
				{
					id: 'annulled-prize',
					drawId: 'draw',
					drawName: 'December',
					name: 'Wrong bike',
					position: 1,
					status: 'annulled',
					deliveredAt: null
				}
			]
		});
		expect(body).toMatch(/Premios ganados\s*<span[^>]*>1<\/span>/);
		expect(body).toContain('No cuenta como ganado');
		expect(body).toContain('Anulado');
		expect(body).toContain('Premio 1, Bike');
		expect(body).toContain('Entregado el 19/11/2026, 23:30');
		expect(body).toContain('/draws/draw/winners');
		expect(body).not.toContain('—');
	});

	it('leaves the prizes out when there are none or the role cannot read them', () => {
		expect(page()).not.toContain('Premios ganados');
		const hidden = page({
			canViewPrizes: false,
			prizes: [
				{ id: 'p', drawId: 'd', drawName: 'D', name: 'Bike', position: 1, status: 'delivered' }
			]
		});
		expect(hidden).not.toContain('Premios ganados');
	});

	it('renders editing only for buyer managers, collapsed until the server answers', () => {
		expect(page()).not.toContain('Guardar cambios');
		const body = page({ canManage: true });
		expect(body).toContain('Editar los datos del comprador');
		expect(body).toContain('action="?/update"');
		expect(body).toContain('Guardar cambios');
		expect(body).not.toMatch(/<details[^>]*\sopen/);
		const answered = page(
			{ canManage: true },
			{ success: false, message: 'Revisar los campos marcados.', errors: {}, values: {} }
		);
		expect(answered).toMatch(/<details[^>]*\sopen[\s\S]*Editar los datos del comprador/);
		expect(answered).toContain('Revisar los campos marcados.');
	});

	it('lists the bonds of other campaigns and the audit, collapsed', () => {
		const body = page({
			historicalBonds: [
				{
					id: 'old-bond',
					campaignId: 'old-campaign',
					campaignName: 'Bono 2025',
					campaignNumberDigits: 4,
					baseNumbers: [7]
				}
			],
			audit: {
				entries: [
					{ id: 'a1', action: 'buyer.create', actorName: 'Admin', createdAt: '2026-11-18' }
				],
				truncated: false
			}
		});
		expect(body).toContain('Bonos de otras campañas');
		expect(body).toContain('Bono 2025');
		expect(body).toContain('0007');
		expect(body).toContain('href="/campaigns/old-campaign/bonds/old-bond"');
		expect(body).toContain('Movimientos registrados');
		expect(body).toContain('buyer.create');
		expect(body).not.toContain('·');
		const none = page();
		expect(none).toContain('No tiene bonos de otras campañas.');
		expect(none).not.toContain('Movimientos registrados');
	});
});

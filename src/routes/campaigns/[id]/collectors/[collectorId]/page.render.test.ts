import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';
import { mapCampaignRow } from '$lib/server/repositories/campaigns';
import { CAMPAIGN_ID, campaignRow } from '../../../test-helpers';

/**
 * Collector record (UX plan PR 15): the sentence, the next step, the short lists and the collapsed
 * groups. The actions are covered by `page.server.test.ts`.
 */
const COLLECTOR_ID = 'c0000000-0000-0000-0000-000000000001';
const TODAY = '2026-11-26';
const CAN = {
	manage: false,
	audit: false,
	viewReports: false,
	viewRules: false,
	manageRules: false,
	pay: false,
	deliver: false,
	viewPayments: true,
	viewSettlements: true
};

const bond = (base: number, status: string, note: number | null = null, extra = {}) => ({
	id: `b0000000-0000-0000-0000-${String(base).padStart(12, '0')}`,
	kind: 'simple',
	baseNumbers: [base],
	associatedNumbers: [base + 4871],
	commercialStatus: status,
	financialStatus: 'up_to_date',
	note: note ? { noteId: `n000000${note}-0000-0000-0000-000000000000`, noteNumber: note } : null,
	...extra
});
const debt = (id: string, base: number, dueDate: string, extra = {}) => ({
	id,
	saleId: `sale-${base}`,
	bondNumbers: [base],
	buyerName: 'Ada Gómez',
	number: 2,
	dueDate,
	owed: '10000.00',
	status: 'pending',
	uncollectible: false,
	...extra
});
const settlement = (number: number, status: string, closedAt: string | null = null) => ({
	id: `s${number}`,
	settlementNumber: number,
	status,
	openedAt: '2026-01-01T02:59:59Z',
	closedAt,
	totals: { totalAmount: '170000.00' }
});

function page(extra: Record<string, unknown> = {}, form: unknown = null) {
	const { can, ...rest } = extra as { can?: Partial<typeof CAN> };
	return render(Page, {
		props: {
			data: {
				collector: {
					id: COLLECTOR_ID,
					displayName: 'Ada Collector',
					phone: null,
					email: null,
					address: null,
					userProfileId: null,
					status: 'active',
					createdBy: null,
					createdAt: '',
					updatedAt: ''
				},
				campaign: mapCampaignRow(campaignRow()),
				bonds: [],
				bondsTotal: 0,
				buyers: [],
				buyersTotal: 0,
				debts: [],
				today: TODAY,
				settlements: [],
				profiles: [],
				ledger: null,
				specialRules: [],
				audit: null,
				custody: { can: { returnBonds: false, reassignBonds: false }, collectors: [] },
				...rest,
				can: { ...CAN, ...can }
			},
			form,
			params: { id: CAMPAIGN_ID, collectorId: COLLECTOR_ID }
		} as never
	}).body.replace(/\u00a0/g, ' ');
}
/** The text of the page, without tags, comments or runs of spaces. */
const textOf = (body: string) =>
	body
		.replace(/<!--.*?-->/g, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ');
const sentence = (body: string) =>
	textOf(/data-collector-sentence[^>]*>([\s\S]*?)<\/p>/.exec(body)![1])
		.replace(/ \./g, '.')
		.trim();

describe('collector record: the first screen', () => {
	it('says the bonds, what is left to collect and the balance, with the next step', () => {
		const body = page({
			bonds: [bond(68, 'delivered_to_collector', 3), bond(70, 'sold'), bond(71, 'sold')],
			bondsTotal: 3,
			debts: [debt('i1', 70, '2026-10-10'), debt('i2', 71, '2026-12-10', { owed: '2500.50' })],
			ledger: { balance: 17.5 },
			can: { pay: true }
		});
		expect(sentence(body)).toBe(
			'Ada Collector tiene 3 bonos: 2 vendidos y 1 sin vender. Le falta cobrar $ 12.500,50, de los cuales $ 10.000 están vencidos. Tiene $ 17,50 a su favor en la cuenta corriente.'
		);
		expect(body).toMatch(/data-collector-lead[\s\S]*Falta cobrar[\s\S]*\$ 12\.500,50/);
		expect(body).toContain(
			`href="/campaigns/${CAMPAIGN_ID}/settlements/new?intent=payment&amp;collector=${COLLECTOR_ID}"`
		);
		expect(body).toContain('Registrar pago');
		// The balance is a sentence on the first screen, and the account is one click away.
		const ledger = `/campaigns/${CAMPAIGN_ID}/collectors/${COLLECTOR_ID}/ledger`;
		expect(body.split(`href="${ledger}"`).length - 1).toBe(2);
		expect(body).toContain('Ver cuenta corriente');
	});

	it('sends to the open settlement when the collector has one', () => {
		const body = page({
			debts: [debt('i1', 70, '2026-12-10')],
			settlements: [settlement(9, 'open'), settlement(8, 'closed', '2026-01-02T02:59:59Z')],
			can: { pay: true }
		});
		expect(body).toContain('Cargar pagos en la rendición 9');
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/settlements/s9"`);
		expect(body).not.toContain('Registrar pago');
	});

	it('offers to deliver bonds when nothing is owed, and nothing the role may not do', () => {
		const deliver = page({ can: { deliver: true, pay: true } });
		expect(deliver).toContain('Entregar bonos');
		expect(deliver).toContain(`href="/campaigns/${CAMPAIGN_ID}/deliveries/new"`);
		expect(deliver).not.toContain('Registrar pago');
		const readOnly = page({ debts: [debt('i1', 70, '2026-12-10')] });
		expect(readOnly).not.toContain('Registrar pago');
		expect(readOnly).not.toContain('Entregar bonos');
		// An inactive collector is not offered more bonds.
		const inactive = page({
			can: { deliver: true },
			collector: {
				id: COLLECTOR_ID,
				displayName: 'Ada Collector',
				phone: null,
				email: null,
				address: null,
				status: 'inactive'
			}
		});
		expect(inactive).not.toContain('Entregar bonos');
		expect(inactive).toContain('Inactivo');
	});

	it('never prints a balance the role cannot read, as zero or otherwise', () => {
		const body = page({ bonds: [bond(68, 'delivered_to_collector')], bondsTotal: 1 });
		expect(sentence(body)).toBe('Ada Collector tiene 1 bono, sin vender.');
		expect(body).not.toContain('/ledger');
		expect(body).not.toContain('cuenta corriente');
		expect(body).not.toContain('data-collector-lead');
		// A balance that could not be computed is left out too.
		expect(sentence(page({ ledger: { balance: null } }))).toBe(
			'Ada Collector no tiene bonos de esta campaña.'
		);
	});

	it('says whom a negative balance favours, without a minus sign', () => {
		const body = page({ ledger: { balance: -5000 } });
		expect(sentence(body)).toContain('Su cuenta corriente tiene $ 5.000 a favor de Bomberos.');
		expect(sentence(body)).not.toMatch(/[-−]/);
	});

	it('shows how to call the collector and the rest of the contact data', () => {
		const body = page({
			collector: {
				id: COLLECTOR_ID,
				displayName: 'Ada Collector',
				phone: '2364 51-2203',
				email: 'ada@example.test',
				address: 'Sarmiento 655',
				status: 'active'
			}
		});
		expect(body).toContain('href="tel:2364512203"');
		expect(body).toContain('Llamar al 2364 51-2203');
		expect(body).toMatch(/data-collector-contact[^>]*>\s*ada@example\.test, Sarmiento 655/);
	});
});

describe('collector record: the short lists', () => {
	it('lists the first 10 unpaid installments and collapses the rest', () => {
		const debts = Array.from({ length: 13 }, (_, i) =>
			debt(`i${i}`, 100 + i, `2026-${i < 4 ? '10' : '12'}-${String(i + 10)}`)
		);
		const body = page({ debts });
		expect(body).toMatch(/Cuotas por cobrar\s*<span[^>]*>13<\/span>/);
		const [shown, rest] = body.split('Ver las otras 3 cuotas');
		expect(shown.match(/data-debt-row/g)).toHaveLength(10);
		expect(rest.match(/data-debt-row/g)).toHaveLength(3);
		expect(textOf(body)).toContain('Cuota 2, venció el 10/10/2026');
		expect(textOf(body)).toContain('Cuota 2, vence el 14/12/2026');
		expect(body.match(/>Vencida</g)).toHaveLength(4);
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/sales/sale-100"`);
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/sales?collector=${COLLECTOR_ID}"`);
		expect(body).not.toContain('Sin permiso para ver los pagos');
	});

	it('says «Ver la otra cuota» for one more, and nothing for ten or fewer', () => {
		const debts = Array.from({ length: 11 }, (_, i) => debt(`i${i}`, 100 + i, '2026-12-10'));
		expect(page({ debts })).toContain('Ver la otra cuota');
		expect(page({ debts: debts.slice(0, 10) })).not.toMatch(/Ver la(s)? otra/);
		expect(page()).not.toContain('Cuotas por cobrar');
	});

	it('names a buyer the role cannot read without a link, and marks an uncollectible sale', () => {
		const body = page({
			debts: [
				debt('i1', 70, '2026-10-10', { buyerName: null }),
				debt('i2', 71, '2026-10-10', { uncollectible: true })
			],
			can: { viewPayments: false }
		});
		expect(body).toContain('Sin acceso al comprador');
		expect(body).not.toContain('Unknown');
		expect(body).not.toContain('/buyers/');
		expect(body).toContain('>Incobrable<');
		expect(textOf(body)).toContain(
			'Sin permiso para ver los pagos: una cuota con un pago parcial, o con un pago que todavía no se confirmó, figura por su importe completo.'
		);
		// What was given up is not part of what is left to collect.
		expect(sentence(body)).toContain(
			'Le falta cobrar $ 10.000, todo vencido. Otros $ 10.000 se dieron por incobrables.'
		);
	});

	it('shows the unsold bonds by number, the notes they came with, and the sold ones collapsed', () => {
		const body = page({
			bonds: [
				bond(68, 'delivered_to_collector', 3),
				bond(69, 'delivered_to_collector', 4),
				bond(70, 'sold', null, { financialStatus: 'overdue' })
			],
			bondsTotal: 3
		});
		expect(body).toMatch(/Bonos\s*<span[^>]*>3<\/span>/);
		expect(textOf(body)).toContain('Sin vender: 2');
		expect(body.match(/data-unsold-bond/g)).toHaveLength(2);
		expect(body).toContain(
			`href="/campaigns/${CAMPAIGN_ID}/bonds/b0000000-0000-0000-0000-000000000068"`
		);
		expect(textOf(/data-unsold-notes[^>]*>([\s\S]*?)<\/p>/.exec(body)![1]).trim()).toBe(
			'Entregados con los remitos 0003 y 0004 .'
		);
		expect(body).toContain(
			`/campaigns/${CAMPAIGN_ID}/deliveries/n0000003-0000-0000-0000-000000000000`
		);
		expect(body).toMatch(/Bonos vendidos[\s\S]*data-bond-row[\s\S]*Vendido[\s\S]*En mora/);
		expect(body.match(/data-bond-row/g)).toHaveLength(1);
	});

	it('collapses the unsold bonds after the first 15', () => {
		const bonds = Array.from({ length: 19 }, (_, i) => bond(200 + i, 'delivered_to_collector', 1));
		const body = page({ bonds, bondsTotal: 19 });
		const [shown, rest] = body.split('Ver los otros 4 bonos sin vender');
		expect(shown.match(/data-unsold-bond/g)).toHaveLength(15);
		expect(rest.match(/data-unsold-bond/g)).toHaveLength(4);
		expect(page({ bonds: bonds.slice(0, 15), bondsTotal: 15 })).not.toContain('bonos sin vender');
		expect(textOf(body)).toContain('Entregados con el remito 0001 .');
		expect(body).not.toContain('Bonos vendidos');
	});

	it('says so when the collector has no bonds, and when more exist than are listed', () => {
		expect(page()).toContain('No tiene bonos de esta campaña.');
		const body = page({ bonds: [bond(68, 'sold')], bondsTotal: 350 });
		expect(body).toContain('No le quedan bonos sin vender.');
		expect(textOf(body)).toContain('Se listan los primeros 1 de 350 bonos.');
	});

	it('lists the settlements with their state, and links the filtered list past 10', () => {
		const body = page({
			settlements: [settlement(4, 'closed', '2026-01-02T02:59:59Z'), settlement(3, 'open')]
		});
		expect(body).toContain('Rendición 4');
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/settlements/s4"`);
		expect(body).toContain('Cerrada el 01/01/2026');
		expect(body).toContain('Abierta el 31/12/2025');
		expect(body.match(/\$ 170\.000/g)).toHaveLength(1);
		expect(body).not.toContain('settlements?collector=');
		const many = page({
			settlements: Array.from({ length: 12 }, (_, i) =>
				settlement(12 - i, 'closed', '2026-01-02T02:59:59Z')
			)
		});
		expect(many.match(/data-settlement-row/g)).toHaveLength(10);
		expect(many).toContain('Ver las 12 rendiciones');
		expect(many).toContain(
			`href="/campaigns/${CAMPAIGN_ID}/settlements?collector=${COLLECTOR_ID}"`
		);
	});

	it('leaves the settlements out for a role that cannot read them', () => {
		expect(page()).toContain('Todavía no tiene rendiciones.');
		const body = page({ can: { viewSettlements: false } });
		expect(body).not.toContain('Rendiciones');
		expect(body).not.toContain('Todavía no tiene rendiciones.');
	});
});

describe('collector record: data and corrections', () => {
	it('renders editing only for collector managers, collapsed', () => {
		expect(page()).not.toContain('Guardar cambios');
		const body = page({ can: { manage: true } });
		expect(body).toContain('Editar los datos del cobrador');
		expect(body).toContain('action="?/update"');
		expect(body).toContain('Guardar cambios');
		expect(body).not.toMatch(/<details[^>]*\sopen/);
	});

	it('opens the form when the server answered about it', () => {
		const body = page(
			{ can: { manage: true } },
			{ success: false, message: 'Revisar el formulario.', errors: { displayName: ['Falta'] } }
		);
		expect(body).toMatch(/<details[^>]*\sopen[\s\S]*Editar los datos del cobrador/);
		expect(body).toContain('Revisar el formulario.');
	});

	it('offers bulk return and reassignment of the unsold bonds, collapsed, on the same actions', () => {
		const body = page({
			bonds: [bond(68, 'delivered_to_collector', 3), bond(70, 'sold')],
			bondsTotal: 2,
			custody: {
				can: { returnBonds: true, reassignBonds: true },
				collectors: [{ id: 'c0000000-0000-0000-0000-000000000002', displayName: 'Beto' }]
			}
		});
		expect(body).toContain('Devolver o reasignar bonos');
		// Only the bond that is still in the collector's hands can be chosen.
		expect(body.match(/name="bondIds"/g)).toHaveLength(1);
		expect(body).toContain('value="b0000000-0000-0000-0000-000000000068"');
		expect(body).toContain('formaction="?/returnBonds"');
		expect(body).toContain('formaction="?/reassignBonds"');
		expect(body).toContain('name="targetCollectorId"');
		expect(body).toContain('Beto');
		expect(body).toContain('Devolver seleccionados');
		expect(body).toContain('Reasignar seleccionados a');
		expect(body).not.toMatch(/<details[^>]*\sopen/);

		const returnOnly = page({
			bonds: [bond(68, 'delivered_to_collector', 3)],
			bondsTotal: 1,
			custody: { can: { returnBonds: true, reassignBonds: false }, collectors: [] }
		});
		expect(returnOnly).toContain('formaction="?/returnBonds"');
		expect(returnOnly).not.toContain('formaction="?/reassignBonds"');

		const readOnly = page({ bonds: [bond(68, 'delivered_to_collector', 3)], bondsTotal: 1 });
		expect(readOnly).not.toContain('name="bondIds"');
		expect(readOnly).not.toContain('formaction=');
		// Nothing to choose from: the block is not shown.
		const sold = page({
			bonds: [bond(70, 'sold')],
			bondsTotal: 1,
			custody: { can: { returnBonds: true, reassignBonds: true }, collectors: [] }
		});
		expect(sold).not.toContain('Devolver o reasignar bonos');
	});

	it('shows a rejected bulk operation inside its block, opened', () => {
		const body = page(
			{
				bonds: [bond(68, 'delivered_to_collector', 3)],
				bondsTotal: 1,
				custody: {
					can: { returnBonds: true, reassignBonds: true },
					collectors: [{ id: 'c0000000-0000-0000-0000-000000000002', displayName: 'Beto' }]
				}
			},
			{
				form: 'custody',
				success: false,
				message: 'Elegir el cobrador que recibe los bonos.',
				errors: { targetCollectorId: ['Elegir el cobrador que recibe los bonos.'] }
			}
		);
		expect(body).toMatch(/<details[^>]*\sopen[\s\S]*Devolver o reasignar bonos/);
		expect(body).toMatch(/role="alert"[\s\S]*Elegir el cobrador que recibe los bonos\./);
	});

	it('lists the usual buyers, the special rules and the audit, each collapsed', () => {
		const body = page({
			buyers: [
				{ id: 'buyer-1', type: 'individual', firstName: 'Ada', lastName: 'Gómez' },
				{ id: 'buyer-2', type: 'business', businessName: 'Panadería La Espiga' }
			],
			buyersTotal: 102,
			specialRules: [
				{
					id: 'r1',
					ruleType: 'installment_first',
					installmentNumber: null,
					percentage: '20',
					fixedAmount: null,
					validFrom: '2026-01-01',
					validTo: null,
					status: 'active'
				}
			],
			audit: {
				entries: [
					{ id: 'a1', action: 'collector.create', actorName: 'Admin', createdAt: '2026-11-18' }
				],
				truncated: false
			},
			can: { viewRules: true, manageRules: true, audit: true, viewReports: true }
		});
		expect(body).toContain('Compradores habituales');
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/buyers/buyer-1"`);
		expect(body).toContain('Gómez, Ada');
		expect(body).toContain('Panadería La Espiga');
		expect(body).toContain('y 100 más');
		expect(body).toContain('data-testid="special-rules"');
		expect(body).toContain('Gestionar reglas especiales');
		expect(body).toContain('Movimientos registrados');
		expect(body).toContain('collector.create');
		expect(body).toContain(
			`/campaigns/${CAMPAIGN_ID}/reports?collector=${COLLECTOR_ID}#monthly-title`
		);
		expect(body).not.toContain('·');
	});

	it('shows none of those to a role without the permissions', () => {
		const body = page();
		for (const title of [
			'Compradores habituales',
			'Reglas especiales de comisión',
			'Movimientos registrados',
			'Resumen operativo mensual',
			'Editar los datos del cobrador'
		])
			expect(body).not.toContain(title);
		expect(body).not.toContain('Informe mensual');
	});
});

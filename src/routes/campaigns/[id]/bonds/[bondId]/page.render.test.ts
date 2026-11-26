import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import type { BondRecord } from '$lib/components/bonds/record/types';
import type { Campaign } from '$lib/domain/campaigns';
import { formatMoney } from '$lib/format';
import Page from './+page.svelte';

const CAMPAIGN_ID = 'f0000000-0000-0000-0000-000000000001';
const BOND_ID = 'b0000000-0000-0000-0000-000000000001';
const MEMBER_B = 'b0000000-0000-0000-0000-000000000002';
const PATA_ID = 'b0000000-0000-0000-0000-0000000000aa';

const campaign: Campaign = {
	id: CAMPAIGN_ID,
	name: 'Campaign 2027',
	status: 'active',
	startsAt: null,
	endsAt: null,
	simpleBondValue: '60000.00',
	installmentCount: 10,
	installmentValue: '6000.00',
	numberDigits: 4,
	maxNumber: 9999,
	associatedNumberOffset: 4871,
	associatedNumberMode: 'linear',
	overflowPolicy: 'reject',
	barcodeMode: 'base_number',
	barcodePattern: null,
	createdBy: null,
	createdAt: '2026-11-17T10:00:00+00:00',
	updatedAt: '2026-11-17T10:00:00+00:00'
};

function record(overrides: Partial<BondRecord> = {}): BondRecord {
	return {
		general: {
			id: BOND_ID,
			kind: 'simple',
			origin: 'printed',
			typeLabel: 'Bono simple',
			commercialStatus: 'available',
			financialStatus: 'no_payments',
			unitCount: 1,
			totalValue: '60000.00',
			internalCode: 'INT-1',
			barcode: null,
			createdAt: '2026-11-17T12:00:00+00:00',
			annulledAt: null,
			annulReason: null,
			annulledFromStatus: null
		},
		numbers: [
			{ formatted: '0068', kind: 'base', released: false, ownerBondId: BOND_ID },
			{ formatted: '4939', kind: 'associated', released: false, ownerBondId: BOND_ID }
		],
		group: { members: [], memberOf: null, pastPatas: [] },
		barcode: {
			barcode: null,
			internalCode: 'INT-1',
			modeLabel: 'El código de barras es el número base'
		},
		collector: { id: null },
		buyer: { id: null },
		audit: { allowed: false, entries: [], truncated: false },
		actions: { ungroup: false, annul: false, lockedMessage: null },
		...overrides
	};
}

function renderPage(
	loaded: BondRecord,
	form: Record<string, unknown> | null = null,
	extra: Record<string, unknown> = {}
) {
	const data = {
		campaign,
		record: loaded,
		custody: {
			history: [],
			collectors: [],
			can: { returnBond: false, reassign: false, markLost: false }
		},
		sale: null,
		today: '2026-11-26',
		parties: { collector: null, buyer: null },
		next: { deliver: false, sell: false, pay: false },
		installments: [],
		payments: [],
		drawRosterEntries: [],
		prizes: [],
		...extra
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal PageProps for SSR
	const props = { data, form, params: { id: CAMPAIGN_ID, bondId: loaded.general.id } } as any;
	return render(Page, { props }).body;
}

describe('/campaigns/[id]/bonds/[bondId] page', () => {
	it('renders ordinary and extraordinary draw roster history with eligibility', () => {
		const body = renderPage(record(), null, {
			canViewDraws: true,
			drawRosterEntries: [
				{
					id: 'entry',
					numberValue: 7,
					numberKind: 'extraordinary',
					eligible: false,
					ineligibilityReason: 'not_fully_paid',
					draw: { id: 'draw', name: 'Full payment special' }
				}
			]
		});
		expect(body).toContain('id="draws-title"');
		expect(body).toContain('Full payment special');
		expect(body).toContain('/draws/draw/roster');
		expect(body).toContain('Participa con 0007 (extraordinario). Bono sin pago total');
		expect(body).toContain('No habilitado');
	});

	it('renders confirmed payment certificates in the Payments section', () => {
		const body = renderPage(record(), null, {
			payments: [
				{
					id: 'payment',
					date: '2026-01-01',
					amount: '12.00',
					method: 'cash',
					status: 'confirmed',
					settlementId: null,
					settlementNumber: null
				}
			]
		});
		expect(body).toContain('Pagos');
		expect(body).toContain(
			'/campaigns/f0000000-0000-0000-0000-000000000001/payments/payment/print'
		);
	});
	it('renders prize history and converts UTC delivery instants to Buenos Aires', () => {
		const body = renderPage(record(), null, {
			canViewPrizes: true,
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
		expect(body).toContain('Premios ganados: 1');
		expect(body).toContain('No cuenta como ganado');
		expect(body).toContain('December');
		expect(body).toContain('N.º 1, Bike');
		expect(body).toContain('Entregado');
		expect(body).toContain('2026-11-19 23:30 (Buenos Aires)');
		expect(body).toContain('/draws/draw/winners');
	});
	it('shows the general data and the formatted numbers of a simple bond', () => {
		const body = renderPage(record());
		// The heading names the kind; the number is the stub's.
		expect(body).toMatch(/<h1[^>]*>(?:<!--.*?-->)*Bono simple(?:<!--.*?-->)*<\/h1>/);
		expect(body).toContain('Número base');
		expect(body).toContain('Datos generales');
		expect(body).toContain(formatMoney('60000.00'));
		expect(body).toContain('INT-1');
		expect(body).toContain('4939');
		expect(body).toContain('Disponible');
		// No actions for this user.
		expect(body).not.toContain('Anular bono');
		expect(body).not.toContain('Desagrupar pata');
	});

	it('offers annulment with a required reason and explains that the numbers are freed', () => {
		const body = renderPage(
			record({ actions: { ungroup: false, annul: true, lockedMessage: null } })
		);
		expect(body).toContain('Anular bono');
		expect(body).toContain('action="?/annul"');
		expect(body).toMatch(/<textarea[^>]*name="reason"[^>]*required/);
		expect(body).toContain('sus números quedan libres');
	});

	it('shows the reason error and the success message', () => {
		const failed = renderPage(
			record({ actions: { ungroup: false, annul: true, lockedMessage: null } }),
			{
				form: 'annul',
				success: false,
				message: 'Corregir los campos marcados.',
				errors: { reason: ['Se requiere un motivo para anular un bono'] }
			}
		);
		expect(failed).toContain('Se requiere un motivo para anular un bono');
		const done = renderPage(
			record({
				general: {
					...record().general,
					commercialStatus: 'annulled',
					annulledAt: '2026-11-17T13:00:00+00:00',
					annulReason: 'Loaded twice',
					annulledFromStatus: 'available'
				},
				numbers: record().numbers.map((n) => ({ ...n, released: true }))
			}),
			{
				form: 'annul',
				success: true,
				message: 'Bono anulado. Sus números quedaron libres y se pueden volver a ingresar.',
				errors: {}
			}
		);
		expect(done).toContain('Bono anulado.');
		expect(done).toContain('Loaded twice');
		expect(done).toContain('Liberado');
		expect(done).toContain('Anulado desde el estado');
		expect(done).toContain('sus números y códigos quedaron libres');
	});

	it('an annulled sale: numbers and codes stay held', () => {
		const body = renderPage(
			record({
				general: {
					...record().general,
					commercialStatus: 'annulled',
					annulledAt: '2026-11-17T13:00:00+00:00',
					annulReason: 'Sale cancelled',
					annulledFromStatus: 'sold'
				}
			})
		);
		expect(body).toContain('Anulado desde el estado');
		expect(body).toContain('Sus números y códigos siguen retenidos');
		expect(body).not.toContain('quedaron libres');
		expect(body).not.toContain('Liberado');
	});

	it('a member of a manual pata: links to the pata, no actions', () => {
		const body = renderPage(
			record({
				group: {
					members: [],
					memberOf: { pataId: PATA_ID, label: '0068 + 0069' },
					pastPatas: []
				}
			})
		);
		expect(body).toContain('En la pata');
		expect(body).toContain('0068 + 0069');
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/${PATA_ID}"`);
		expect(body).not.toContain('Anular bono');
	});

	it('a manual pata: members with links, ungroup action and ungroup history', () => {
		const body = renderPage(
			record({
				general: {
					...record().general,
					id: PATA_ID,
					kind: 'pata',
					origin: 'manual_grouping',
					typeLabel: 'Pata agrupada manualmente',
					unitCount: 2,
					totalValue: '120000.00'
				},
				numbers: [
					{ formatted: '0068', kind: 'base', released: false, ownerBondId: BOND_ID },
					{ formatted: '4939', kind: 'associated', released: false, ownerBondId: BOND_ID },
					{ formatted: '0069', kind: 'base', released: false, ownerBondId: MEMBER_B },
					{ formatted: '4940', kind: 'associated', released: false, ownerBondId: MEMBER_B }
				],
				group: {
					memberOf: null,
					pastPatas: [],
					members: [
						{
							bondId: BOND_ID,
							baseFormatted: '0068',
							associatedFormatted: '4939',
							groupedAt: '2026-11-17T12:00:00+00:00',
							ungroupedAt: null,
							reason: null
						},
						{
							bondId: MEMBER_B,
							baseFormatted: '0069',
							associatedFormatted: '4940',
							groupedAt: '2026-11-16T12:00:00+00:00',
							ungroupedAt: '2026-11-16T15:00:00+00:00',
							reason: 'Wrong bonds'
						}
					]
				},
				actions: { ungroup: true, annul: false, lockedMessage: null }
			})
		);
		expect(body).toMatch(/<h1[^>]*>(?:<!--.*?-->)*Pata agrupada manualmente(?:<!--.*?-->)*<\/h1>/);
		expect(body).toContain('Números base');
		expect(body).toContain('0068 + 0069');
		expect(body).toContain(formatMoney('120000.00'));
		expect(body).toContain('Miembros');
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/${MEMBER_B}"`);
		expect(body).toContain('Bono miembro');
		expect(body).toContain('Historial de desagrupaciones');
		expect(body).toContain('Wrong bonds');
		expect(body).toContain('action="?/ungroup"');
		expect(body).toContain('Desagrupar pata');
	});

	it('explains why an available bond cannot be changed in a closed campaign', () => {
		const body = renderPage(
			record({
				actions: {
					ungroup: false,
					annul: false,
					lockedMessage: 'Los bonos solo se pueden cargar o modificar ... La campaña está cerrada.'
				}
			})
		);
		expect(body).toContain('La campaña está cerrada.');
		expect(body).not.toContain('action="?/annul"');
	});
	it('opens with the summary; the reference data and the corrections are collapsed underneath', () => {
		const body = renderPage(
			record({ actions: { ungroup: false, annul: true, lockedMessage: null } })
		);
		// No index of fourteen numbered sections any more.
		expect(body).not.toContain('href="#general"');
		expect(body).not.toMatch(/<span[^>]*>\d+\.<\/span>/);
		const order = [
			'data-bond-summary',
			'Historial y correcciones',
			'Entregas y devoluciones',
			'Datos del bono',
			'Corregir o anular'
		].map((text) => body.indexOf(text));
		expect(order.every((at) => at >= 0)).toBe(true);
		expect([...order].sort((a, b) => a - b)).toEqual(order);
		// The groups are closed <details>: their content is in the page, not on the first screen.
		expect(body.match(/<details[^>]*>/g)?.every((tag) => !/\sopen/.test(tag))).toBe(true);
		for (const id of ['general', 'numbers', 'barcode', 'custody'])
			expect(body).toContain(`<section id="${id}"`);
	});

	it('an available bond: says so in a sentence, with no leftovers of how the system was built', () => {
		const body = renderPage(record());
		expect(body).toContain('Disponible. Todavía no se entregó a ningún cobrador.');
		expect(body).toContain('0068');
		expect(body).toContain('Número asociado 4939');
		// Audit A10: no «fase», no sections that only said they were empty.
		expect(body.toLowerCase()).not.toContain('fase');
		for (const gone of [
			'Cobrador actual',
			'Comprador actual',
			'No figura en ninguna rendición.',
			'No se generaron comisiones.',
			'Sin plan de cuotas.',
			'Sin premios.'
		])
			expect(body).not.toContain(gone);
		expect(body).not.toContain('id="installments-title"');
		expect(body).not.toContain('id="draws-title"');
		// The reference data is still there, collapsed.
		expect(body).toContain('Este bono no se entregó a ningún cobrador.');
		expect(body).toContain('El código de barras es el número base');
		expect(body).toContain('No se registró un código de barras para este bono.');
	});

	it('audit: a note without audit.view; entries with actor, reason and pata link', () => {
		// Without audit.view the group is not offered at all.
		expect(renderPage(record())).not.toContain('Movimientos registrados');

		const body = renderPage(
			record({
				audit: {
					allowed: true,
					truncated: false,
					entries: [
						{
							id: 'a2',
							action: 'bond.group',
							actionLabel: 'Agrupado en una pata',
							createdAt: '2026-11-17T13:00:00+00:00',
							actorLabel: 'Operator One',
							reason: null,
							summary: 'Este bono se agrupó en la pata 0068 + 0069',
							viaPata: { pataId: PATA_ID, label: '0068 + 0069' },
							oldValue: null,
							newValue: '{\n  "members": []\n}',
							requestId: 'req-2'
						},
						{
							id: 'a1',
							action: 'bond.create',
							actionLabel: 'Cargado',
							createdAt: '2026-11-17T12:00:00+00:00',
							actorLabel: 'Un usuario',
							reason: 'Batch 3',
							summary: 'Números 0068, 4939',
							viaPata: null,
							oldValue: null,
							newValue: '{}',
							requestId: null
						}
					]
				}
			})
		);
		expect(body).toContain('Movimientos registrados');
		expect(body.indexOf('data-audit-action="bond.group"')).toBeLessThan(
			body.indexOf('data-audit-action="bond.create"')
		);
		expect(body).toContain('Operator One');
		expect(body).toContain('Motivo: Batch 3');
		expect(body).toContain('Números 0068, 4939');
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/${PATA_ID}"`);

		const empty = renderPage(record({ audit: { allowed: true, entries: [], truncated: false } }));
		expect(empty).toContain('Este bono no tiene entradas de auditoría.');
	});

	it('a simple bond that was in an ungrouped pata shows it as history', () => {
		const body = renderPage(
			record({
				group: {
					members: [],
					memberOf: null,
					pastPatas: [
						{
							pataId: PATA_ID,
							label: '0068 + 0069',
							groupedAt: '2026-11-16T12:00:00+00:00',
							ungroupedAt: '2026-11-16T15:00:00+00:00',
							reason: 'Wrong bonds'
						}
					]
				}
			})
		);
		expect(body).toContain('Patas anteriores');
		expect(body).toContain('No está en ninguna pata.');
		expect(body).toContain('Wrong bonds');
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/${PATA_ID}"`);
	});
});

describe('bond sale sections', () => {
	it('a sold bond: who bought it, who collects it, what is owed, and the next step', () => {
		const sold = record();
		sold.general.commercialStatus = 'sold';
		sold.general.financialStatus = 'overdue';
		const installment = (number: number, dueDate: string, over: Record<string, unknown> = {}) => ({
			id: `i${number}`,
			installmentNumber: number,
			dueDate,
			amount: '10000.00',
			applied: '0.00',
			lastPayment: null,
			status: 'pending',
			...over
		});
		const extra = {
			sale: {
				sale: {
					id: 'a0000000-0000-0000-0000-000000000009',
					paymentMode: 'installments',
					totalAmount: '30000.00',
					status: 'active'
				},
				plan: { status: 'active' }
			},
			parties: {
				collector: { id: 'col', name: 'Héctor Acosta', canOpen: true },
				buyer: { id: 'buy', name: 'Stella Rodríguez', phone: '2364 47-1234', canOpen: true }
			},
			next: { deliver: true, sell: true, pay: true },
			installments: [
				installment(1, '2026-09-22', {
					status: 'paid',
					applied: '10000.00',
					lastPayment: {
						date: '2026-10-09',
						method: 'cash',
						settlementId: 's',
						settlementNumber: 14
					}
				}),
				installment(2, '2026-10-22', { status: 'overdue' }),
				installment(3, '2027-01-01')
			]
		};
		const body = renderPage(sold, null, extra);
		const text = body
			.replace(/<!--.*?-->/g, '')
			.replace(/<[^>]+>/g, '')
			.replaceAll('\u00a0', ' ')
			.replace(/\s+/g, ' ');
		expect(text).toContain(
			'Vendido a Stella Rodríguez en 3 cuotas. Lo cobra Héctor Acosta. Pagó 1 cuota y debe $ 20.000, de los cuales $ 10.000 están vencidos.'
		);
		// The names are links for a role that can open those records.
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/buyers/buy"`);
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/collectors/col"`);
		// One next step for the state (pay), and the buyer's phone as a call link.
		expect(body).toContain(
			`href="/campaigns/${CAMPAIGN_ID}/settlements/new?intent=payment&amp;collector=col"`
		);
		expect(body).toContain('Registrar pago');
		expect(body).not.toContain('Registrar venta');
		expect(body).not.toContain('Entregar a un cobrador');
		expect(body).toContain('href="tel:2364471234"');
		expect(body).toContain('Llamar al 2364 47-1234');
		// Installments: what is owed on each, the paid one with when and how, and the total.
		expect(body).toContain('/sales/a0000000-0000-0000-0000-000000000009');
		expect(body).toContain('Ver la venta');
		expect(text).toContain('Pagada el 09/10/2026 en efectivo, rendición 14');
		expect(text).toContain('Venció el 22/10/2026');
		expect(text).toContain('Vence el 01/01/2027');
		expect(text).toContain('Falta cobrar $ 20.000');
		// The badge comes from the same installments as the sentence, not from a stored snapshot.
		expect(body).toContain('En mora');

		// A payment whose settlement is still open does not count yet: the installment still owes it,
		// the bond is still overdue, and the line says where that money is.
		const waiting = renderPage(sold, null, {
			...extra,
			installments: [
				installment(1, '2026-09-22', {
					status: 'overdue',
					waiting: '10000.00',
					waitingPayment: {
						date: '2026-11-25',
						method: 'transfer',
						settlementId: 's',
						settlementNumber: 3,
						submittedByCollector: false
					}
				}),
				installment(2, '2027-01-01', {
					waiting: '4000.00',
					waitingPayment: {
						date: '2026-11-26',
						method: 'cash',
						settlementId: null,
						settlementNumber: null,
						submittedByCollector: true
					}
				})
			]
		})
			.replace(/<!--.*?-->/g, '')
			.replace(/<[^>]+>/g, '')
			.replaceAll('\u00a0', ' ')
			.replace(/\s+/g, ' ');
		expect(waiting).toContain('Todavía no pagó ninguna cuota y debe $ 20.000');
		expect(waiting).toContain(
			'Pago de $ 10.000 por transferencia cargado en la rendición 3, que sigue abierta'
		);
		expect(waiting).toContain(
			'Cobro de $ 4.000 enviado por el cobrador el 26/11/2026, sin procesar'
		);
		expect(waiting).not.toContain('Pagada el');
		expect(waiting).toContain('En mora');
		expect(waiting).toContain('Falta cobrar $ 20.000');

		// A role that cannot read payments is told so, instead of being shown a guessed balance.
		expect(renderPage(sold, null, { ...extra, canViewPayments: false })).toContain(
			'Sin permiso para ver los pagos'
		);
		expect(body).not.toContain('Sin permiso para ver los pagos');

		// A role that can read the names but not open the records: text, no links.
		const plain = renderPage(sold, null, {
			...extra,
			parties: {
				collector: { ...extra.parties.collector, canOpen: false },
				buyer: { ...extra.parties.buyer, canOpen: false }
			},
			next: { deliver: false, sell: false, pay: false }
		});
		expect(plain).toContain('Stella Rodríguez');
		expect(plain).not.toContain('/buyers/buy');
		expect(plain).not.toContain('/collectors/col');
		expect(plain).not.toContain('Registrar pago');

		// A role that cannot read the buyer at all: the sentence does without the name.
		const unnamed = renderPage(sold, null, {
			...extra,
			parties: { collector: extra.parties.collector, buyer: null }
		})
			.replace(/<!--.*?-->/g, '')
			.replace(/<[^>]+>/g, '')
			.replace(/\s+/g, ' ');
		expect(unnamed).toContain('Vendido en 3 cuotas.');
		expect(unnamed).not.toContain('Unknown');
		expect(unnamed).not.toContain('Llamar');
	});

	it('the next step follows the state, and only when the role may take it', () => {
		const next = { deliver: true, sell: true, pay: true };
		const available = renderPage(record(), null, { next });
		expect(available).toContain('Entregar a un cobrador');
		expect(available).toContain(`href="/campaigns/${CAMPAIGN_ID}/deliveries/new"`);
		expect(available).not.toContain('Registrar venta');

		const delivered = record();
		delivered.general.commercialStatus = 'delivered_to_collector';
		const withCollector = {
			next,
			parties: { collector: { id: 'col', name: 'Héctor Acosta', canOpen: false }, buyer: null }
		};
		const body = renderPage(delivered, null, withCollector);
		expect(body).toContain('Registrar venta');
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/sales/new"`);
		expect(body).not.toContain('Entregar a un cobrador');
		expect(body).toContain('Héctor Acosta');
		expect(
			renderPage(delivered, null, { ...withCollector, next: { ...next, sell: false } })
		).not.toContain('Registrar venta');

		const lost = record();
		lost.general.commercialStatus = 'lost';
		const lostBody = renderPage(lost, null, { next });
		expect(lostBody).toContain('Extraviado.');
		for (const label of ['Entregar a un cobrador', 'Registrar venta', 'Registrar pago'])
			expect(lostBody).not.toContain(label);
	});

	it('a collapsed group opens by itself when the server answered about something inside it', () => {
		const opened = (body: string, summary: string) => {
			const at = body.indexOf(summary);
			return /\sopen/.test(body.slice(body.lastIndexOf('<details', at), at));
		};
		const custody = renderPage(record(), {
			form: 'custody',
			success: false,
			message: 'No se pudo.'
		});
		expect(opened(custody, 'Entregas y devoluciones')).toBe(true);
		const annul = renderPage(
			record({ actions: { ungroup: false, annul: true, lockedMessage: null } }),
			{
				form: 'annul',
				success: false,
				message: 'Revisar.',
				errors: { reason: ['Falta el motivo.'] }
			}
		);
		expect(opened(annul, 'Corregir o anular')).toBe(true);
		expect(opened(annul, 'Entregas y devoluciones')).toBe(false);
	});
});

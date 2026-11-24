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
		expect(body).toContain('Sorteos y padrones');
		expect(body).toContain('0007');
		expect(body).toContain('Extraordinario');
		expect(body).toContain('Bono sin pago total');
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
		expect(body).toContain('N.º 1 — Bike');
		expect(body).toContain('Entregado');
		expect(body).toContain('2026-11-19 23:30 (Buenos Aires)');
		expect(body).toContain('/draws/draw/winners');
	});
	it('shows the general data and the formatted numbers of a simple bond', () => {
		const body = renderPage(record());
		expect(body).toContain('Bono simple 0068');
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
		expect(body).toContain('Pata agrupada manualmente 0068 + 0069');
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
	it('renders the 14 numbered sections in order, with an index of anchors', () => {
		const body = renderPage(record());
		const titles = [
			'Datos generales',
			'Números participantes',
			'Código de barras',
			'Cobrador actual',
			'Historial de asignaciones',
			'Comprador actual',
			'Venta',
			'Cuotas',
			'Pagos',
			'Rendiciones',
			'Comisiones',
			'Sorteos y padrones',
			'Premios',
			'Auditoría'
		];
		const ids = [
			'general',
			'numbers',
			'barcode',
			'collector',
			'custody',
			'buyer',
			'sale',
			'installments',
			'payments',
			'settlements',
			'commissions',
			'draws',
			'prizes',
			'audit'
		];
		let last = -1;
		ids.forEach((id, i) => {
			const at = body.indexOf(`<section id="${id}"`);
			expect(at, id).toBeGreaterThan(last);
			last = at;
			expect(body).toContain(`aria-labelledby="${id}-title"`);
			expect(body).toContain(`href="#${id}"`);
			expect(body).toMatch(
				new RegExp(
					`<h2 id="${id}-title"[^>]*>\\s*(?:<!--[^>]*-->)*<span[^>]*>${i + 1}\\.</span>(?:<!--[^>]*-->)*\\s*${titles[i]}`
				)
			);
		});
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds"`);
	});

	it('later-phase sections show empty states; collector and buyer are not set', () => {
		const body = renderPage(record());
		expect(body).toContain('No se entregó a un cobrador.');
		expect(body).toContain('Sin comprador: el bono no se vendió.');
		expect(body).toContain('Este bono no se vendió.');
		expect(body).toContain('Sin plan de cuotas.');
		expect(body).toContain('No hay pagos registrados.');
		expect(body).toContain('No figura en ninguna rendición.');
		expect(body).toContain('No se generaron comisiones.');
		expect(body).toContain('No figura en ningún padrón de sorteo.');
		expect(body).toContain('Sin premios.');
		expect(body).toContain('El código de barras es el número base');
		expect(body).toContain('No se registró un código de barras para este bono.');
		expect(body).toContain('No hay pagos');
	});

	it('audit: a note without audit.view; entries with actor, reason and pata link', () => {
		expect(renderPage(record())).toContain('No hay permiso para ver el registro de auditoría.');

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
		expect(body).not.toContain('No hay permiso para ver el registro de auditoría.');
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
	it('links its active sale and shows pending installments', () => {
		const data = {
			campaign,
			record: record(),
			custody: {
				history: [],
				collectors: [],
				can: { returnBond: false, reassign: false, markLost: false }
			},
			sale: {
				sale: {
					id: 'a0000000-0000-0000-0000-000000000009',
					paymentMode: 'installments',
					totalAmount: '60000.00'
				}
			},
			installments: [
				{
					id: 'i',
					installmentNumber: 1,
					dueDate: '2027-01-01',
					amount: '6000.00',
					status: 'pending'
				}
			]
		};
		const body = render(Page, {
			props: { data, form: null, params: { id: CAMPAIGN_ID, bondId: BOND_ID } } as never
		}).body;
		expect(body).toContain('Venta activa');
		expect(body).toContain('/sales/a0000000-0000-0000-0000-000000000009');
		expect(body).toContain('01/01/2027');
	});
});

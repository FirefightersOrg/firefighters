import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import type { Campaign } from '$lib/domain/campaigns';
import Page from './+page.svelte';
import ConfigPage from './configuracion/+page.svelte';

const V1 = '2026-11-17T10:00:00.123456+00:00';
const V2 = '2026-11-17T10:05:00.654321+00:00';

function campaign(overrides: Partial<Campaign> = {}): Campaign {
	return {
		id: 'f0000000-0000-0000-0000-000000000001',
		name: 'Campaign 2026',
		status: 'draft',
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
		createdAt: V1,
		updatedAt: V1,
		...overrides
	};
}

const can = {
	editName: true,
	editDates: true,
	editRules: true,
	transitions: [],
	registerSale: false,
	deliverBonds: false,
	openSettlement: false,
	viewCommissions: false,
	viewBonds: false,
	loadBonds: false,
	viewCollectors: false,
	viewBuyers: false,
	viewDeliveries: false,
	viewSales: false,
	viewDraws: false
};

function renderPage(
	loaded: Campaign,
	form: Record<string, unknown> | null = null,
	extra: { hasBonds?: boolean; can?: Partial<typeof can>; dashboard?: unknown } = {}
) {
	const data = {
		campaign: loaded,
		dashboard: extra.dashboard ?? { operational: null, financial: null },
		hasBonds: extra.hasBonds ?? false,
		can: { ...can, ...extra.can }
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal PageProps for SSR
	const props = { data, form, params: { id: loaded.id } } as any;
	return render(Page, { props }).body;
}

/** Datos y reglas (/campaigns/[id]/configuracion): same data, holds the summary and the edit forms. */
function renderConfig(...args: Parameters<typeof renderPage>) {
	const [loaded, form = null, extra = {}] = args;
	const data = {
		campaign: loaded,
		dashboard: extra.dashboard ?? { operational: null, financial: null },
		hasBonds: extra.hasBonds ?? false,
		can: { ...can, ...extra.can }
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal PageProps for SSR
	const props = { data, form, params: { id: loaded.id } } as any;
	return render(ConfigPage, { props }).body;
}

describe('campaign sections (moved to the shell)', () => {
	// The rail and the tab bar of the campaign shell list the sections now, by permission:
	// src/lib/navigation.test.ts and CampaignShell.render.test.ts cover who sees which.
	it('does not list the sections on the page, whatever the person can see', () => {
		const body = renderPage(campaign(), null, {
			can: {
				viewBonds: true,
				viewCollectors: true,
				viewBuyers: true,
				viewDraws: true
			}
		});
		const base = '/campaigns/f0000000-0000-0000-0000-000000000001';
		for (const section of ['collectors', 'buyers', 'draws', 'settlements', 'deliveries', 'sales'])
			expect(body).not.toContain(`href="${base}/${section}"`);
		expect(body).not.toContain('aria-label="Secciones de la campaña"');
		for (const title of ['Operación', 'Personas', 'Administración'])
			expect(body).not.toContain(title);
	});
});

/** The page's visible text, with tags, comments and no-break spaces out of the way. */
const text = (body: string) =>
	body
		.replace(/<!--.*?-->/g, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;|\u00a0/g, ' ')
		.replace(/\s+/g, ' ')
		.replace(/ ([.,;:])/g, '$1');

describe('«Para resolver»: collector-submitted payments waiting (SAN-156)', () => {
	const operational = (submitted: unknown) => ({
		operational: {
			bonds: { total: 1, sold: 0, available: 1, delivered: 0, returned: 0, annulled: 0 },
			revenue: {
				expected: '0.00',
				collected: '0.00',
				pending: '0.00',
				overdue: '0.00',
				collectedPercent: 0
			},
			nextDraw: null,
			atRisk: [],
			submitted
		},
		financial: null
	});
	const withRows = {
		count: 3,
		amount: '175.50',
		byCollector: [
			{
				collectorId: 'a',
				collectorName: 'Ana',
				count: 2,
				amount: '100.00',
				openSettlementId: 'set-1'
			},
			{ collectorId: 'b', collectorName: 'Beto', count: 1, amount: '75.50', openSettlementId: null }
		]
	};
	const base = '/campaigns/f0000000-0000-0000-0000-000000000001';
	it('names each collector, the amount in whole pesos and the place that resolves it', () => {
		const body = renderPage(campaign({ status: 'active' }), null, {
			dashboard: operational(withRows),
			can: { viewSettlements: true, openSettlement: true } as never
		});
		const plain = text(body);
		expect(plain).toContain('Para resolver');
		expect(plain).toContain('2 cobros enviados por Ana sin procesar');
		expect(plain).toContain(
			'$ 100. Su rendición no se puede cerrar hasta incluirlos o rechazarlos.'
		);
		expect(body).toContain(`href="${base}/settlements/set-1"`);
		// Beto has no open settlement: the item opens one for him.
		expect(plain).toContain('1 cobro enviado por Beto sin procesar');
		expect(plain).toContain('$ 76. No tiene una rendición abierta');
		expect(body).toContain(`href="${base}/settlements/new?intent=payment&amp;collector=b"`);
		expect(plain).toContain('Abrir una rendición');
	});
	it('sends to the settlements list when the role cannot open a settlement', () => {
		const body = renderPage(campaign({ status: 'active' }), null, {
			dashboard: operational(withRows),
			can: { viewSettlements: true } as never
		});
		expect(body).toContain(`href="${base}/settlements?status=open"`);
		expect(body).not.toContain('settlements/new');
	});
	it('says what waits without a link when the role does not see settlements', () => {
		const body = renderPage(campaign({ status: 'active' }), null, {
			dashboard: operational(withRows)
		});
		expect(text(body)).toContain('2 cobros enviados por Ana sin procesar');
		expect(body).not.toContain('/settlements');
	});
	it('does not draw the section when nothing waits', () => {
		const body = renderPage(campaign({ status: 'active' }), null, {
			dashboard: operational({ count: 0, amount: '0.00', byCollector: [] })
		});
		expect(body).not.toContain('Para resolver');
		expect(body).not.toContain('dash-todo');
	});
	it('lists the open settlements the shell counted, with a link to them', () => {
		const data = {
			campaign: campaign({ status: 'active' }),
			dashboard: { operational: null, financial: null },
			hasBonds: true,
			can: { ...can, viewSettlements: true },
			shell: { campaign: { id: 'x', name: 'x' }, openSettlements: 3 }
		};
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal PageProps for SSR
		const body = render(Page, { props: { data, form: null, params: { id: 'x' } } as any }).body;
		expect(text(body)).toContain('3 rendiciones abiertas');
		expect(body).toContain(`href="${base}/settlements?status=open"`);
		// A role that does not see settlements is not told about them.
		data.can = { ...can, viewSettlements: false };
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal PageProps for SSR
		const hidden = render(Page, { props: { data, form: null, params: { id: 'x' } } as any }).body;
		expect(hidden).not.toContain('rendiciones abiertas');
	});
});

/** `value` of the input named `name` inside the form posting to `action`. */
function inputValue(body: string, action: string, name: string): string | undefined {
	const form = body.match(new RegExp(`<form[^>]*action="\\?/${action}"[\\s\\S]*?</form>`))?.[0];
	const input = form?.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0];
	return input?.match(/value="([^"]*)"/)?.[1];
}

describe('campaign page edit forms (values and version come from the same load)', () => {
	it('posts the loaded version with the loaded values', () => {
		const body = renderConfig(campaign());
		expect(inputValue(body, 'update', 'expectedUpdatedAt')).toBe(V1);
		expect(inputValue(body, 'update', 'name')).toBe('Campaign 2026');
		expect(inputValue(body, 'rules', 'expectedUpdatedAt')).toBe(V1);
		expect(inputValue(body, 'rules', 'installmentCount')).toBe('10');
	});

	it('refills a failed submit based on the loaded version (validation errors stay)', () => {
		const body = renderConfig(campaign(), {
			form: 'general',
			success: false,
			message: 'Revisar los campos marcados.',
			errors: { name: ['El nombre es obligatorio'] },
			values: { name: '', startsOn: '', endsOn: '', expectedUpdatedAt: V1 }
		});
		expect(inputValue(body, 'update', 'name')).toBe('');
		expect(inputValue(body, 'update', 'expectedUpdatedAt')).toBe(V1);
		expect(body).toContain('El nombre es obligatorio');
	});

	it('never pairs values submitted at an older version with the newer loaded version', () => {
		const reloaded = campaign({ name: 'Renamed elsewhere', updatedAt: V2 });
		const body = renderConfig(reloaded, {
			form: 'general',
			success: false,
			message: 'Otra persona modificó esta campaña.',
			errors: {},
			values: { name: 'Old name', startsOn: '', endsOn: '', expectedUpdatedAt: V1 }
		});
		expect(inputValue(body, 'update', 'name')).toBe('Renamed elsewhere');
		expect(inputValue(body, 'update', 'expectedUpdatedAt')).toBe(V2);
	});

	describe('rules form (with its change reason)', () => {
		const rulesFailure = (expectedUpdatedAt: string) => ({
			form: 'rules',
			success: false,
			message: 'Revisar los campos marcados.',
			errors: { confirmRulesChange: ['Confirmar los cambios en las reglas antes de guardar.'] },
			values: {
				simpleBondValue: '70000',
				installmentCount: '7',
				numberDigits: '4',
				maxNumber: '9999',
				associatedNumberOffset: '4871',
				associatedNumberMode: 'linear',
				overflowPolicy: 'reject',
				barcodeMode: 'base_number',
				changeReason: 'Board decision',
				confirmRulesChange: '',
				expectedUpdatedAt
			}
		});
		const reasonOf = (body: string) =>
			body.match(/<textarea[^>]*name="changeReason"[^>]*>([\s\S]*?)<\/textarea>/)?.[1];

		it('refills the submitted rules and reason when based on the loaded version', () => {
			const body = renderConfig(campaign(), rulesFailure(V1));
			expect(inputValue(body, 'rules', 'installmentCount')).toBe('7');
			expect(reasonOf(body)).toBe('Board decision');
			expect(inputValue(body, 'rules', 'expectedUpdatedAt')).toBe(V1);
		});

		it('drops the submitted rules and reason when the campaign has a newer version', () => {
			const body = renderConfig(
				campaign({ installmentCount: 12, updatedAt: V2 }),
				rulesFailure(V1)
			);
			expect(inputValue(body, 'rules', 'installmentCount')).toBe('12');
			expect(reasonOf(body)).toBe('');
			expect(inputValue(body, 'rules', 'expectedUpdatedAt')).toBe(V2);
		});
	});
});

describe('campaign page: bonds', () => {
	it('shows the rules of a draft with bonds as frozen, explaining why, without the rules form', () => {
		const body = renderConfig(campaign(), null, { hasBonds: true, can: { editRules: false } });
		expect(body).toContain('Las reglas están congeladas.');
		expect(body).toContain('Esta campaña ya tiene bonos');
		expect(body).toContain('aunque la campaña siga siendo un');
		expect(body).not.toMatch(/action="\?\/rules"/);
		// General data stays editable.
		expect(body).toMatch(/action="\?\/update"/);
	});

	it('explains the status when an active campaign has frozen rules', () => {
		const body = renderConfig(campaign({ status: 'active' }), null, {
			hasBonds: true,
			can: { editRules: false }
		});
		expect(body).toContain('Esta campaña está activa');
		expect(body).not.toContain('Esta campaña ya tiene bonos');
	});

	it('links to bond loading only when allowed', () => {
		const href = '/campaigns/f0000000-0000-0000-0000-000000000001/bonds/new';
		expect(renderPage(campaign(), null, { can: { loadBonds: true } })).toContain(`href="${href}"`);
		expect(renderPage(campaign())).not.toContain(href);
	});

	it('reaches the bonds list through its search, only with bond.view', () => {
		const action = 'action="/campaigns/f0000000-0000-0000-0000-000000000001/bonds"';
		expect(renderPage(campaign(), null, { can: { viewBonds: true } })).toContain(action);
		expect(renderPage(campaign())).not.toContain(action);
	});
});

const operational = {
	submitted: { count: 0, amount: '0.00', byCollector: [] },
	bonds: { total: 20, sold: 6, available: 10, delivered: 4, returned: 0, annulled: 0 },
	revenue: {
		expected: '3000.00',
		collected: '1500.00',
		pending: '1500.00',
		overdue: '300.00',
		collectedPercent: 50
	},
	nextDraw: {
		id: 'd1',
		name: 'Sorteo de diciembre',
		type: 'monthly',
		drawDate: '2026-12-20',
		paymentCutoffAt: '2026-12-15T12:00:00-03:00',
		requiredInstallmentNumber: 3,
		status: 'scheduled',
		atRiskCount: 2
	},
	atRisk: [
		{
			bondId: 'b0000000-0000-0000-0000-000000000001',
			kind: 'simple',
			baseNumber: 7,
			collectorId: 'c1',
			collectorName: 'Ana',
			missingInstallments: 2,
			requiredInstallments: 3,
			totalCount: 2
		},
		{
			bondId: 'b0000000-0000-0000-0000-000000000002',
			kind: 'simple',
			baseNumber: null,
			collectorId: null,
			collectorName: null,
			missingInstallments: 1,
			requiredInstallments: 3,
			totalCount: 2
		}
	]
};

const financial = {
	cash: { cash: '1000.00', transfer: '500.00', total: '1500.00' },
	commissions: {
		generated: '150.00',
		settled: '100.00',
		pending: '50.00',
		closedSettlements: 3,
		openSettlements: 1,
		settledCash: '900.00',
		settledTransfer: '400.00'
	},
	balances: {
		creditors: 1,
		net: '-20.00',
		top: [
			{
				collectorId: 'c1',
				collectorName: 'Ana',
				entryCount: 2,
				creditTotal: '0.00',
				debitTotal: '20.00',
				balance: '-20.00',
				lastEntryOn: null
			}
		]
	}
};

describe('campaign home: figures, balances and the next draw', () => {
	it('shows no figures to a viewer without report permissions', () => {
		const body = renderPage(campaign());
		expect(body).not.toContain('dash-figures');
		expect(body).not.toContain('Estado de la campaña');
		expect(body).not.toContain('Próximo sorteo');
	});

	it('shows one line of figures, each with what it is measured against', () => {
		const plain = text(
			renderPage(campaign(), null, {
				dashboard: { operational, financial: null },
				can: { viewReports: true } as never
			})
		);
		for (const piece of [
			'Bonos vendidos 6 de 20',
			'En manos de cobradores 4 sin vender; 10 sin entregar',
			'Cobrado $ 1.500',
			'de $ 3.000 vendidos',
			'Cuotas vencidas sin cobrar $ 300 de $ 1.500 por cobrar',
			'Reportes'
		])
			expect(plain).toContain(piece);
		expect(plain).not.toContain('Efectivo y transferencias');
	});

	it('names the bonds that may miss the next draw under their item, with links to their records', () => {
		const body = renderPage(campaign(), null, { dashboard: { operational, financial: null } });
		const plain = text(body);
		expect(plain).toContain('2 bonos vendidos pueden quedar fuera de «Sorteo de diciembre»');
		expect(plain).toContain('El sorteo exige la cuota 3 paga. El corte es el 15/12/2026, 12:00');
		expect(plain).toContain('Ver los bonos');
		expect(body.match(/data-at-risk-bond/g)).toHaveLength(2);
		expect(plain).toContain('0007 Lo cobra Ana faltan 2 cuotas');
		expect(plain).toContain('Bono sin número Sin cobrador falta 1 cuota');
		expect(body).toContain('/bonds/b0000000-0000-0000-0000-000000000001');
		// The list is collapsed: it is inside a <details> that is not open.
		expect(body).toMatch(/<details class="group">/);
		expect(body).not.toMatch(/<details[^>]*open/);
	});

	it('says how many bonds are not shown when the list is cut', () => {
		const cut = operational.atRisk.map((bond) => ({ ...bond, totalCount: 40 }));
		const body = renderPage(campaign(), null, {
			dashboard: { operational: { ...operational, atRisk: cut }, financial: null }
		});
		expect(text(body)).toContain('Se muestran 2 de 40 bonos.');
	});

	it('shows the next draw as one row, linked for who sees draws', () => {
		const dashboard = { operational, financial: null };
		const plain = text(renderPage(campaign(), null, { dashboard }));
		expect(plain).toContain('Próximo sorteo');
		expect(plain).toContain('Sorteo de diciembre Mensual, exige la cuota 3 paga 20/12/2026');
		expect(plain).toContain('corte el 15/12/2026, 12:00');
		expect(renderPage(campaign(), null, { dashboard })).not.toContain('/draws/d1');
		expect(renderPage(campaign(), null, { dashboard, can: { viewDraws: true } })).toContain(
			'href="/campaigns/f0000000-0000-0000-0000-000000000001/draws/d1"'
		);
	});

	it('says so when there is no draw to come, and lists no bonds', () => {
		const body = renderPage(campaign(), null, {
			dashboard: { operational: { ...operational, nextDraw: null, atRisk: [] }, financial: null }
		});
		expect(body).toContain('No hay sorteos programados.');
		expect(body).not.toContain('Para resolver');
	});

	it('shows the balances in words, never with a bare sign, and the commission to pay out', () => {
		const body = renderPage(campaign(), null, {
			dashboard: { operational: null, financial },
			can: { viewCollectors: true }
		});
		const plain = text(body);
		expect(plain).toContain('Saldo a favor de cada cobrador');
		// Ana owes: her balance is in favour of the institution, and it says so.
		expect(plain).toContain('Ana $ 20 a favor de Bomberos');
		expect(body).not.toMatch(/-\$|−/);
		expect(plain).toContain('Comisión sin liquidar $ 50');
		expect(body).toContain('href="/campaigns/f0000000-0000-0000-0000-000000000001/collectors/c1"');
		expect(plain).not.toContain('Próximo sorteo');
		// The cash and commission breakdowns live in the reports, not on the home.
		for (const gone of ['Efectivo y transferencias', 'Generadas', 'Liquidadas', 'Saldo neto'])
			expect(plain).not.toContain(gone);
	});

	it('leaves zero balances out and says when there are none', () => {
		const none = {
			...financial,
			balances: {
				creditors: 0,
				net: '0.00',
				top: [{ ...financial.balances.top[0], balance: '0.00' }]
			},
			commissions: { ...financial.commissions, pending: '0.00' }
		};
		const plain = text(
			renderPage(campaign(), null, { dashboard: { operational: null, financial: none } })
		);
		expect(plain).toContain('Ningún cobrador tiene saldo.');
		expect(plain).not.toContain('Comisión sin liquidar');
	});

	it('shows no amount with cents', () => {
		const odd = {
			operational: {
				...operational,
				revenue: {
					expected: '3000.75',
					collected: '1500.50',
					pending: '1500.25',
					overdue: '300.49',
					collectedPercent: 50
				},
				submitted: {
					count: 1,
					amount: '75.50',
					byCollector: [
						{
							collectorId: 'b',
							collectorName: 'Beto',
							count: 1,
							amount: '75.50',
							openSettlementId: null
						}
					]
				}
			},
			financial: {
				...financial,
				commissions: { ...financial.commissions, pending: '50.55' },
				balances: {
					...financial.balances,
					top: [{ ...financial.balances.top[0], balance: '20.49' }]
				}
			}
		};
		const plain = text(
			renderPage(campaign({ status: 'active', installmentValue: '6000.00' }), null, {
				dashboard: odd,
				can: { viewSettlements: true } as never
			})
		);
		expect(plain).not.toMatch(/\$ [\d.]+,\d/);
		for (const piece of ['$ 1.501', '$ 3.001', '$ 300 de $ 1.500', '$ 76', '$ 51', '$ 20'])
			expect(plain).toContain(piece);
	});

	it('says which part could not be loaded, and keeps the rest', () => {
		const body = renderPage(campaign(), null, {
			dashboard: { operational: { error: true }, financial }
		});
		expect(body).toContain('No se pudieron cargar los bonos, lo cobrado y el próximo sorteo.');
		expect(text(body)).toContain('Saldo a favor de cada cobrador');
	});
});

describe('campaign home: search, actions and order', () => {
	it('puts the bond search first, as a GET to the bonds list, only with bond.view', () => {
		expect(renderPage(campaign())).not.toContain('role="search"');
		const body = renderPage(campaign(), null, { can: { viewBonds: true } });
		expect(body).toContain('role="search"');
		expect(body).toContain('action="/campaigns/f0000000-0000-0000-0000-000000000001/bonds"');
		expect(body).toContain('name="base"');
	});
	it("lists the four day's actions by permission; the only primary button is the search", () => {
		expect(renderPage(campaign())).not.toContain('Registrar venta');
		const body = renderPage(campaign({ status: 'active' }), null, {
			can: {
				viewBonds: true,
				registerSale: true,
				deliverBonds: true,
				openSettlement: true,
				loadBonds: true
			}
		});
		const actions = body.match(/<ul[^>]*data-day-actions[\s\S]*?<\/ul>/)?.[0] ?? '';
		expect(text(actions).trim()).toBe('Registrar venta Registrar pago Entregar bonos Cargar bonos');
		// «Registrar pago» goes through the collector: to their open settlement, or to open one.
		expect(actions).toContain('/settlements/new?intent=payment');
		expect(actions).not.toContain('bg-primary');
		// A pata is loaded from the bonds list, not from the home.
		expect(body).not.toContain('Cargar una pata');
		expect(body.indexOf('role="search"')).toBeLessThan(body.indexOf('data-day-actions'));
	});
	it('goes search, actions, «Para resolver», figures, balances and draw, then the close', () => {
		const data = {
			campaign: campaign({ status: 'active', startsAt: '2026-06-29', endsAt: '2027-06-29' }),
			dashboard: { operational, financial },
			hasBonds: true,
			can: { ...can, viewBonds: true, registerSale: true, transitions: ['closing'] },
			shell: null
		};
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal PageProps for SSR
		const body = render(Page, { props: { data, form: null, params: { id: 'x' } } as any }).body;
		const order = [
			'role="search"',
			'data-day-actions',
			'id="dash-todo"',
			'id="dash-figures"',
			'id="dash-balances"',
			'id="dash-next-draw"',
			'id="status"'
		].map((mark) => body.indexOf(mark));
		expect(order.every((at) => at >= 0)).toBe(true);
		expect([...order].sort((x, y) => x - y)).toEqual(order);
	});
	it('puts «Activar» before everything else on a draft', () => {
		const body = renderPage(campaign(), null, {
			can: { viewBonds: true, transitions: ['active'] } as never
		});
		expect(body.indexOf('id="status"')).toBeGreaterThan(-1);
		expect(body.indexOf('id="status"')).toBeLessThan(body.indexOf('role="search"'));
	});
	it('keeps Datos y reglas one click away, and the rules off the home', () => {
		const body = renderPage(campaign(), null, {
			can: { viewBonds: true, viewCollectors: true, viewDraws: true }
		});
		// From the header of the page (the shell also lists it under Administración).
		expect(body).toContain('href="/campaigns/f0000000-0000-0000-0000-000000000001/configuracion"');
		// The rules and their forms live in Datos y reglas, not on the home.
		expect(body).not.toContain('?/rules');
		expect(body).not.toContain('Política de desborde');
	});
	it('shows the dates and the installment plan under the title', () => {
		expect(text(renderPage(campaign()))).toContain('Sin fechas definidas, 10 cuotas de $ 6.000');
		const dated = { startsAt: '2026-06-29', endsAt: '2027-06-29' };
		expect(text(renderPage(campaign(dated)))).toContain('Del 29/06/2026 al 29/06/2027, 10 cuotas');
		// Under way, what matters is when it ends.
		expect(text(renderPage(campaign({ ...dated, status: 'active' })))).toContain(
			'Hasta el 29/06/2027, 10 cuotas'
		);
	});
});

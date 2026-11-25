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

describe('campaign draw navigation', () => {
	it('shows Draws when any draw capability grants read access', () => {
		const body = renderPage(campaign(), null, { can: { viewDraws: true } });
		expect(body).toContain('/draws');
		expect(body).toContain('Sorteos');
	});
});

describe('dashboard: collector-submitted payments waiting (SAN-156)', () => {
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
	it('shows the count, the amount and a link to where each collector is handled', () => {
		const body = renderPage(campaign({ status: 'active' }), null, {
			dashboard: operational(withRows),
			can: { viewSettlements: true } as never
		});
		expect(body).toContain('Cobros enviados sin procesar');
		expect(body).toContain('3 cobros enviados');
		expect(body).toContain('Ana');
		expect(body).toContain('/settlements/set-1');
		expect(body).toContain('Ver rendiciones (no hay una abierta)');
	});
	it('says there is no access to settlements instead of linking', () => {
		const body = renderPage(campaign({ status: 'active' }), null, {
			dashboard: operational(withRows)
		});
		expect(body).toContain('Sin acceso a rendiciones');
		expect(body).not.toContain('/settlements/set-1');
	});
	it('does not render the card when nothing is waiting', () => {
		const body = renderPage(campaign({ status: 'active' }), null, {
			dashboard: operational({ count: 0, amount: '0.00', byCollector: [] })
		});
		expect(body).not.toContain('Cobros enviados sin procesar');
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

	it('links to the bonds list only with bond.view', () => {
		const href = 'href="/campaigns/f0000000-0000-0000-0000-000000000001/bonds"';
		expect(renderPage(campaign(), null, { can: { viewBonds: true } })).toContain(href);
		expect(renderPage(campaign())).not.toContain(href);
	});

	it('links to collectors and buyers only for users who can read them', () => {
		const collectors = 'href="/campaigns/f0000000-0000-0000-0000-000000000001/collectors"';
		const buyers = 'href="/campaigns/f0000000-0000-0000-0000-000000000001/buyers"';
		const none = renderPage(campaign(), null);
		expect(none).not.toContain(collectors);
		expect(none).not.toContain(buyers);
		const both = renderPage(campaign(), null, { can: { viewCollectors: true, viewBuyers: true } });
		expect(both).toContain(collectors);
		expect(both).toContain(buyers);
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

describe('campaign dashboard', () => {
	it('shows no figures to a viewer without report permissions', () => {
		expect(renderPage(campaign())).not.toContain('dash-figures');
	});

	it('shows the operational groups with links to the Bond Record', () => {
		const body = renderPage(campaign(), null, { dashboard: { operational, financial: null } });
		for (const text of [
			'Bonos vendidos',
			'de 20',
			'En manos de cobradores',
			'10 disponibles',
			'Cobrado',
			'50 % de lo esperado',
			'Cuotas vencidas',
			'Próximo sorteo',
			'Sorteo de diciembre',
			'Cuota requerida: 3',
			'Bonos en riesgo',
			'0007',
			'Ana',
			'Sin cobrador',
			'Sin número'
		]) {
			expect(body).toContain(text);
		}
		expect(body).toContain('/bonds/b0000000-0000-0000-0000-000000000001');
		expect(body).not.toContain('Efectivo y transferencias');
	});

	it('shows the financial groups, with a signed balance', () => {
		const body = renderPage(campaign(), null, { dashboard: { operational: null, financial } });
		for (const text of [
			'Efectivo y transferencias',
			'Comisiones',
			'Generadas',
			'Liquidadas',
			'Saldos de cobradores',
			'Saldo neto'
		]) {
			expect(body).toContain(text);
		}
		expect(body).toMatch(/-\$[\s\u00a0]20,00/);
		expect(body).toContain('Hay 1 rendición abierta.');
		expect(body).not.toContain('Próximo sorteo');
	});

	it('says so when there is no draw to come', () => {
		const body = renderPage(campaign(), null, {
			dashboard: { operational: { ...operational, nextDraw: null, atRisk: [] }, financial: null }
		});
		expect(body).toContain('No hay sorteos programados.');
		expect(body).not.toContain('Ningún bono vendido está en riesgo');
	});

	it('says no sold bond is at risk when the list is empty', () => {
		const body = renderPage(campaign(), null, {
			dashboard: { operational: { ...operational, atRisk: [] }, financial: null }
		});
		expect(body).toContain('Ningún bono vendido está en riesgo para este sorteo.');
	});
});

describe('campaign workbench (redesign)', () => {
	it('puts the bond search first, as a GET to the bonds list, only with bond.view', () => {
		expect(renderPage(campaign())).not.toContain('role="search"');
		const body = renderPage(campaign(), null, { can: { viewBonds: true } });
		expect(body).toContain('role="search"');
		expect(body).toContain('action="/campaigns/f0000000-0000-0000-0000-000000000001/bonds"');
		expect(body).toContain('name="base"');
	});
	it("lists the day's actions by permission, the first one as the primary button", () => {
		expect(renderPage(campaign())).not.toContain('Registrar venta');
		const body = renderPage(campaign({ status: 'active' }), null, {
			can: { registerSale: true, deliverBonds: true, openSettlement: true }
		});
		for (const text of ['Registrar venta', 'Entregar bonos a un cobrador', 'Abrir rendición'])
			expect(body).toContain(text);
		expect(body.indexOf('Registrar venta')).toBeLessThan(body.indexOf('Abrir rendición'));
	});
	it('groups the sections and keeps Administración (with Datos y reglas) collapsed', () => {
		const body = renderPage(campaign(), null, {
			can: { viewBonds: true, viewCollectors: true, viewDraws: true }
		});
		for (const text of ['Operación', 'Personas', 'Sorteos y reportes', 'Administración'])
			expect(body).toContain(text);
		expect(body).toContain('<details');
		expect(body).toContain('/campaigns/f0000000-0000-0000-0000-000000000001/configuracion');
		// Also reachable from the header, not only from the collapsed Administración group.
		expect(body.match(/\/configuracion"/g)?.length).toBeGreaterThanOrEqual(2);
		// The rules and their forms live in Datos y reglas, not on the workbench.
		expect(body).not.toContain('?/rules');
		expect(body).not.toContain('Política de desborde');
	});
	it('shows dates and the installment plan under the title', () => {
		expect(renderPage(campaign())).toMatch(/Sin fechas definidas, 10 cuotas de \$[\s\u00a0]6\.000/);
	});
});

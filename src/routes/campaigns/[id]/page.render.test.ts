import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import type { Campaign } from '$lib/domain/campaigns';
import Page from './+page.svelte';

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

describe('campaign draw navigation', () => {
	it('shows Draws when any draw capability grants read access', () => {
		const body = renderPage(campaign(), null, { can: { viewDraws: true } });
		expect(body).toContain('/draws');
		expect(body).toContain('Sorteos');
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
		const body = renderPage(campaign());
		expect(inputValue(body, 'update', 'expectedUpdatedAt')).toBe(V1);
		expect(inputValue(body, 'update', 'name')).toBe('Campaign 2026');
		expect(inputValue(body, 'rules', 'expectedUpdatedAt')).toBe(V1);
		expect(inputValue(body, 'rules', 'installmentCount')).toBe('10');
	});

	it('refills a failed submit based on the loaded version (validation errors stay)', () => {
		const body = renderPage(campaign(), {
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
		const body = renderPage(reloaded, {
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
			const body = renderPage(campaign(), rulesFailure(V1));
			expect(inputValue(body, 'rules', 'installmentCount')).toBe('7');
			expect(reasonOf(body)).toBe('Board decision');
			expect(inputValue(body, 'rules', 'expectedUpdatedAt')).toBe(V1);
		});

		it('drops the submitted rules and reason when the campaign has a newer version', () => {
			const body = renderPage(campaign({ installmentCount: 12, updatedAt: V2 }), rulesFailure(V1));
			expect(inputValue(body, 'rules', 'installmentCount')).toBe('12');
			expect(reasonOf(body)).toBe('');
			expect(inputValue(body, 'rules', 'expectedUpdatedAt')).toBe(V2);
		});
	});
});

describe('campaign page: bonds', () => {
	it('shows the rules of a draft with bonds as frozen, explaining why, without the rules form', () => {
		const body = renderPage(campaign(), null, { hasBonds: true, can: { editRules: false } });
		expect(body).toContain('Las reglas están congeladas.');
		expect(body).toContain('Esta campaña ya tiene bonos');
		expect(body).toContain('aunque la campaña siga siendo un');
		expect(body).not.toMatch(/action="\?\/rules"/);
		// General data stays editable.
		expect(body).toMatch(/action="\?\/update"/);
	});

	it('explains the status when an active campaign has frozen rules', () => {
		const body = renderPage(campaign({ status: 'active' }), null, {
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
	it('shows no dashboard to a viewer without report permissions', () => {
		expect(renderPage(campaign())).not.toContain('Tablero');
	});

	it('shows the operational groups with links to the Bond Record', () => {
		const body = renderPage(campaign(), null, { dashboard: { operational, financial: null } });
		for (const text of [
			'Tablero',
			'Vendidos',
			'Disponibles',
			'Entregados',
			'Esperada',
			'Cobrada',
			'Pendiente',
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
		// Same money format as the rest of the dashboard: whole amounts without forced cents.
		expect(body).toMatch(/-\$[\s\u00a0]20</);
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

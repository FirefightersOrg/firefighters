import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import type { Campaign } from '$lib/domain/campaigns';
import { formatMoney } from '$lib/format';
import type { BondListItem } from '$lib/server/bonds/list';
import Page from './+page.svelte';

const CAMPAIGN_ID = 'f0000000-0000-0000-0000-000000000001';
const BOND_ID = 'b0000000-0000-0000-0000-000000000001';
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

const EMPTY_VALUES = { base: '', associated: '', code: '', type: '', status: '', financial: '' };

function bond(overrides: Partial<BondListItem> = {}): BondListItem {
	return {
		id: BOND_ID,
		kind: 'simple',
		origin: 'printed',
		typeLabel: 'Bono simple',
		baseFormatted: ['0068'],
		associatedFormatted: ['4939'],
		internalCode: 'INT-1',
		barcode: null,
		commercialStatus: 'available',
		financialStatus: 'no_payments',
		unitCount: 1,
		totalValue: '60000.00',
		inPata: null,
		...overrides
	};
}

function renderPage(
	options: {
		bonds?: BondListItem[];
		values?: Partial<typeof EMPTY_VALUES>;
		errors?: Record<string, string>;
		page?: number;
		total?: number;
		canCreate?: boolean;
		canImport?: boolean;
		canScan?: boolean;
	} = {}
) {
	const bonds = options.bonds ?? [bond()];
	const total = options.total ?? bonds.length;
	const values = { ...EMPTY_VALUES, ...options.values };
	const data = {
		campaign,
		query: { values, errors: options.errors ?? {} },
		bonds,
		pagination: {
			page: options.page ?? 1,
			pageSize: 25,
			total,
			pageCount: Math.max(1, Math.ceil(total / 25))
		},
		filtered: Object.values(values).some(Boolean),
		can: {
			create: options.canCreate ?? false,
			importFile: options.canImport ?? false,
			scan: options.canScan ?? false
		}
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal PageProps for SSR
	const props = { data, form: null, params: { id: CAMPAIGN_ID } } as any;
	return render(Page, { props }).body;
}

describe('/campaigns/[id]/bonds page', () => {
	it('shows each bond with padded numbers, status badges, es-AR money and its record link', () => {
		const body = renderPage();
		expect(body).toContain('0068');
		expect(body).toContain('4939');
		expect(body).toContain('Bono simple');
		expect(body).toContain('INT-1');
		expect(body).toContain('Disponible');
		expect(body).toContain('Sin pagos');
		expect(body).toContain(formatMoney('60000.00'));
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/${BOND_ID}"`);
		expect(body).toContain('Ver ficha');
		expect(body).toContain('Mostrando 1–1 de 1 bono');
	});

	it('a grouped member says which pata it is in, with a link', () => {
		const body = renderPage({
			bonds: [bond({ inPata: { pataId: PATA_ID, label: '0068 + 0069' } })]
		});
		expect(body).toContain('En la pata');
		expect(body).toContain('0068 + 0069');
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/${PATA_ID}"`);
	});

	it('is a GET form that refills the filters; collector and buyer are disabled', () => {
		const body = renderPage({
			values: { base: '68', code: 'BC-1', type: 'pata', status: 'sold', financial: 'overdue' }
		});
		expect(body).toMatch(/<form[^>]*method="GET"/);
		expect(body).toContain(`action="/campaigns/${CAMPAIGN_ID}/bonds"`);
		expect(body).toMatch(/<input[^>]*name="base"[^>]*value="68"/);
		expect(body).toMatch(/<input[^>]*name="code"[^>]*value="BC-1"/);
		expect(body).toMatch(/<option value="pata"\sselected="">/);
		expect(body).toMatch(/<option value="sold"\sselected="">/);
		expect(body).toMatch(/<option value="overdue"\sselected="">/);
		expect(body).toMatch(/<select[^>]*id="filter-collector"[^>]*\sdisabled=""/);
		expect(body).toMatch(/<select[^>]*id="filter-buyer"[^>]*\sdisabled=""/);
		expect(body).toContain('Disponible con cobradores y compradores (fase 5).');
		expect(body).toContain('Quitar filtros');
	});

	it('quick actions: create, scan and import only when allowed; assignment disabled with its phase', () => {
		const viewer = renderPage();
		expect(viewer).not.toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/new"`);
		expect(viewer).not.toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/pata/new"`);
		expect(viewer).not.toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/scan"`);
		expect(viewer).not.toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/import"`);
		expect(viewer).toMatch(
			/<button[^>]*aria-describedby="assign-action-note"[^>]*\sdisabled=""[^>]*>[\s\S]*?Asignar a cobrador/
		);
		expect(viewer).toContain('Fase 6');

		const importer = renderPage({ canScan: true, canImport: true });
		expect(importer).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/scan"`);
		expect(importer).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/import"`);

		const operator = renderPage({ canCreate: true });
		expect(operator).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/new"`);
		expect(operator).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/pata/new"`);
		expect(operator).toContain('Cargar bono');
		expect(operator).toContain('Cargar pata');
	});

	it('paginates keeping the filters in the links', () => {
		const body = renderPage({ values: { status: 'available' }, page: 2, total: 60 });
		expect(body).toContain('Página 2 de 3');
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds?status=available"`);
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds?status=available&amp;page=3"`);
		expect(body).toContain('Mostrando 26–50 de 60 bonos');
	});

	it('empty states and invalid filters', () => {
		expect(renderPage({ bonds: [] })).toContain('Todavía no hay bonos');
		expect(renderPage({ bonds: [], values: { base: '1' } })).toContain(
			'Ningún bono coincide con los filtros'
		);
		const invalid = renderPage({
			bonds: [],
			values: { base: '12345' },
			errors: { base: 'Ingresar un número entre 0000 y 9999.' }
		});
		expect(invalid).toContain('Ingresar un número entre 0000 y 9999.');
		expect(invalid).toMatch(/<input[^>]*name="base"[^>]*aria-invalid="true"/);
		expect(invalid).toContain('Corregir los filtros marcados para ver los bonos.');
		expect(renderPage({ bonds: [], total: 3, page: 9 })).toContain('No hay bonos en esta página');
	});
});

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
	associatedNumberMode: 'linear',
	overflowPolicy: 'reject',
	barcodeMode: 'base_number',
	barcodePattern: null,
	createdBy: null,
	createdAt: '2026-11-17T10:00:00+00:00',
	updatedAt: '2026-11-17T10:00:00+00:00'
};

const EMPTY_VALUES = {
	base: '',
	associated: '',
	code: '',
	type: '',
	status: '',
	financial: '',
	collector: ''
};

type Row = BondListItem & { collectorName: string | null; buyerName: string | null };

function bond(overrides: Partial<Row> = {}): Row {
	return {
		collectorName: null,
		buyerName: null,
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
		bonds?: Row[];
		values?: Partial<typeof EMPTY_VALUES>;
		errors?: Record<string, string>;
		collectorName?: string | null;
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
		filterCollectorName: options.collectorName ?? null,
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
		// The number is the link to the record: no separate «Ver ficha» column.
		expect(body).toMatch(
			new RegExp(`<a[^>]*href="/campaigns/${CAMPAIGN_ID}/bonds/${BOND_ID}"[^>]*>[\\s\\S]*?0068`)
		);
		expect(body).not.toContain('Ver ficha');
		expect(body).toContain('Mostrando 1–1 de 1 bono');
		// Below 720px the row is stacked instead of scrolled sideways.
		expect(body).toContain('max-[719px]:');
	});

	it('a grouped member says which pata it is in, with a link', () => {
		const body = renderPage({
			bonds: [bond({ inPata: { pataId: PATA_ID, label: '0068 + 0069' } })]
		});
		expect(body).toContain('En la pata');
		expect(body).toContain('0068 + 0069');
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/${PATA_ID}"`);
	});

	it('says who has each bond or who bought it, and nothing when it cannot (audit A7)', () => {
		const text = (rows: Row[]) =>
			renderPage({ bonds: rows })
				.replace(/<!--.*?-->/g, '')
				.replace(/<[^>]+>/g, ' ')
				.replace(/\s+/g, ' ');
		const sold = bond({ commercialStatus: 'sold' });
		expect(
			text([{ ...sold, buyerName: 'Stella Rodríguez', collectorName: 'Héctor Acosta' }])
		).toContain('Vendido a Stella Rodríguez, lo cobra Héctor Acosta');
		expect(text([{ ...sold, collectorName: 'Héctor Acosta' }])).toContain('Lo cobra Héctor Acosta');
		expect(
			text([bond({ commercialStatus: 'delivered_to_collector', collectorName: 'Héctor Acosta' })])
		).toContain('Lo tiene Héctor Acosta');
		expect(text([bond({ commercialStatus: 'lost', collectorName: 'Héctor Acosta' })])).toContain(
			'Lo tenía Héctor Acosta'
		);
		// No name to show: a dash, never «Unknown» or a placeholder sentence.
		const unnamed = text([sold, bond({ id: PATA_ID })]);
		expect(unnamed).not.toMatch(/Vendido a|Lo tiene|Unknown|undefined|null/);
	});

	it('is a GET form with the number first and the other filters folded, refilled', () => {
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
		// The filters that never worked are gone, with their «fase 5» note.
		expect(body).not.toContain('filter-collector');
		expect(body).not.toContain('filter-buyer');
		expect(body.toLowerCase()).not.toContain('fase');
		// The number is the search field, in front; the rest is folded under «Filtrar» with a count.
		expect(body.indexOf('name="base"')).toBeLessThan(body.indexOf('<details'));
		expect(body.indexOf('<details')).toBeLessThan(body.indexOf('name="code"'));
		expect(body).toMatch(/data-filter-count[^>]*>\s*(?:<!--.*?-->)*4/);
		// What is applied shows as chips; each one links to the list without it.
		expect(body).toContain('Quitar el filtro Estado: Vendido');
		expect(body).toContain('Quitar el filtro Pagos: En mora');
		expect(body).toContain('Quitar el filtro Tipo: Pata');
		expect(body).toContain(
			`href="/campaigns/${CAMPAIGN_ID}/bonds?base=68&amp;type=pata&amp;status=sold&amp;financial=overdue"`
		);
		expect(body).toContain('Quitar todos');
	});

	it('quick actions: create, scan and import only when allowed; no disabled leftovers', () => {
		const viewer = renderPage();
		expect(viewer).not.toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/new"`);
		expect(viewer).not.toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/pata/new"`);
		expect(viewer).not.toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/scan"`);
		expect(viewer).not.toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/import"`);
		// Delivery has its own screen: the disabled «Asignar a cobrador» and its «Fase 6» are gone.
		expect(viewer).not.toContain('Asignar a cobrador');
		expect(viewer).not.toContain('Fase 6');

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

	describe('collector filter', () => {
		const COLLECTOR = 'c0000000-0000-0000-0000-0000000000c1';

		it('shows the collector as a chip that links to the list without it, and keeps it in the form', () => {
			const body = renderPage({
				values: { collector: COLLECTOR, status: 'sold' },
				collectorName: 'Héctor Acosta'
			});
			expect(body).toContain('Quitar el filtro Cobrador: Héctor Acosta');
			expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds?status=sold"`);
			expect(body).toMatch(/<input[^>]*type="hidden"[^>]*name="collector"/);
		});

		it('says so, with no error, when the collector is unknown and no bond matches', () => {
			const body = renderPage({
				bonds: [],
				total: 0,
				values: { collector: COLLECTOR },
				collectorName: null
			});
			expect(body).toContain('No se encontró el cobrador indicado');
			expect(body).not.toContain('Corregir los filtros');
		});

		it('names the collector when they simply have no bonds', () => {
			const body = renderPage({
				bonds: [],
				total: 0,
				values: { collector: COLLECTOR },
				collectorName: 'Héctor Acosta'
			});
			expect(body).toContain('Héctor Acosta');
			expect(body).toContain('no tiene bonos');
		});

		it('explains an invalid id and offers to remove it', () => {
			const body = renderPage({
				bonds: [],
				total: 0,
				values: { collector: 'xx' },
				errors: { collector: 'El cobrador indicado no es válido.' }
			});
			expect(body).toContain('El cobrador indicado no es válido.');
			expect(body).toContain('Quitar ese filtro');
		});
	});
});

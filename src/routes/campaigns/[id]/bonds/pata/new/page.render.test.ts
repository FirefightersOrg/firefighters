import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import PataNumbersPreview from '$lib/components/bonds/PataNumbersPreview.svelte';
import type { Campaign } from '$lib/domain/campaigns';
import { formatMoney } from '$lib/format';
import Page from './+page.svelte';

const CAMPAIGN_ID = 'f0000000-0000-0000-0000-000000000001';
const A = 'b0000000-0000-0000-0000-000000000001';
const B = 'b0000000-0000-0000-0000-000000000002';
const C = 'b0000000-0000-0000-0000-000000000003';
const PATA = 'b0000000-0000-0000-0000-0000000000bb';

function campaign(overrides: Partial<Campaign> = {}): Campaign {
	return {
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
		updatedAt: '2026-11-17T10:00:00+00:00',
		...overrides
	};
}

const member = (id: string, base: string, assoc: string, problem: string | null = null) => ({
	id,
	baseFormatted: base,
	associatedFormatted: assoc,
	internalCode: null,
	problem,
	pataId: problem?.includes('pata') ? PATA : null
});

function grouping(overrides: Record<string, unknown> = {}) {
	return {
		query: '',
		searchError: null,
		searchLimit: 20,
		results: [{ id: C, baseFormatted: '0012', associatedFormatted: '4883', internalCode: 'X-1' }],
		selected: [member(A, '0010', '4881'), member(B, '0011', '4882')],
		unitCount: 2,
		totalValue: '120000.00',
		...overrides
	};
}

function renderPage(
	options: {
		loaded?: Campaign;
		mode?: 'printed' | 'grouping';
		form?: Record<string, unknown> | null;
		grouping?: ReturnType<typeof grouping> | null;
		lockedMessage?: string | null;
	} = {}
) {
	const loaded = options.loaded ?? campaign();
	const mode = options.mode ?? 'printed';
	const data = {
		campaign: loaded,
		canLoad: !options.lockedMessage,
		lockedMessage: options.lockedMessage ?? null,
		mode,
		grouping: mode === 'grouping' ? (options.grouping ?? grouping()) : null
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal PageProps for SSR
	const props = { data, form: options.form ?? null, params: { id: loaded.id } } as any;
	return render(Page, { props }).body;
}

/** Opening tag of the submit button whose label contains `label`. */
const submitTag = (body: string, label: string) =>
	[...body.matchAll(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<\/button>/g)]
		.map((m) => m[0])
		.find((button) => button.includes('type="submit"') && button.includes(label))
		?.match(/^<button[^>]*>/)?.[0] ?? '';
/** The `disabled` attribute itself, not the `disabled:` Tailwind variants in `class`. */
const isDisabled = (tag: string) => /\sdisabled=""/.test(tag);

describe('PataNumbersPreview', () => {
	it('shows the pairs, N, the participating number count and the es-AR total', () => {
		const body = render(PataNumbersPreview, {
			props: {
				rows: [
					{ key: '0', baseFormatted: '0068', associatedFormatted: '4939' },
					{ key: '1', baseFormatted: '0069', associatedFormatted: '4940' }
				],
				unitCount: 2,
				totalValue: '120000.00',
				simpleBondValue: '60000.00',
				emptyText: 'Todavía nada'
			}
		}).body;
		expect(body).toContain('0068');
		expect(body).toContain('4940');
		expect(body).toContain(formatMoney('120000.00'));
		expect(body).toContain(`${formatMoney('60000.00')} × 2`);
		expect(body).toMatch(/Números participantes<\/dt>\s*<dd[^>]*>\s*4\s*<\/dd>/);
	});

	it('lists problems and invalid rows', () => {
		const body = render(PataNumbersPreview, {
			props: {
				rows: [{ key: '0', baseFormatted: '5129', associatedFormatted: null, problem: 'Desborda' }],
				problems: ['Una pata necesita al menos 2 números base'],
				unitCount: 1,
				totalValue: '60000.00',
				simpleBondValue: '60000.00',
				emptyText: 'Todavía nada'
			}
		}).body;
		expect(body).toContain('Desborda');
		expect(body).toContain('Una pata necesita al menos 2 números base.');
	});
});

describe('/campaigns/[id]/bonds/pata/new page', () => {
	it('renders the printed pata form by default, with both mode links', () => {
		const body = renderPage();
		expect(body).toContain('Cargar una pata');
		expect(body).toMatch(/<textarea[^>]*name="baseNumbers"/);
		expect(body).toContain('action="?/printed"');
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/pata/new?mode=printed"`);
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/pata/new?mode=grouping"`);
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/new"`);
		expect(isDisabled(submitTag(body, 'Guardar pata'))).toBe(true);
	});

	it('refills the base numbers and previews them, with campaign-wide duplicates linked', () => {
		const body = renderPage({
			form: {
				form: 'pata',
				success: false,
				message: 'Corregir los campos marcados.',
				errors: { baseNumbers: ['El número 0068 ya está en uso en otro bono de esta campaña.'] },
				conflicts: [{ field: 'baseNumbers', bondId: A, numbers: ['0068'] }],
				values: { baseNumbers: '68, 69', internalCode: '', barcode: '' }
			}
		});
		expect(body).toContain('68, 69</textarea>');
		expect(body).toContain('4939');
		expect(body).toContain('4940');
		expect(body).toContain(formatMoney('120000.00'));
		expect(body).toContain('El número 0068 ya está en uso en otro bono de esta campaña.');
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/${A}"`);
		expect(body).toContain('Ver el bono que usa 0068');
	});

	it('flags an overflow and an intra-pata repetition live', () => {
		const overflow = renderPage({
			form: {
				form: 'pata',
				success: false,
				message: 'Corregir los campos marcados.',
				errors: {},
				values: { baseNumbers: '68 5129', internalCode: '', barcode: '' }
			}
		});
		expect(overflow).toContain('el número base más alto permitido es 5128');
		const repeated = renderPage({
			form: {
				form: 'pata',
				success: false,
				message: 'x',
				errors: {},
				values: { baseNumbers: '68 4939', internalCode: '', barcode: '' }
			}
		});
		expect(repeated).toContain('El número 4939 aparece más de una vez en esta pata');
	});

	it('warns that the first bond freezes a draft', () => {
		expect(renderPage({ loaded: campaign({ status: 'draft' }) })).toContain(
			'Guardar el primer bono congela sus reglas'
		);
	});

	it('explains a locked campaign instead of the forms', () => {
		const body = renderPage({
			lockedMessage: 'Los bonos solo se pueden cargar ... La campaña está cerrada.'
		});
		expect(body).toContain('No se pueden cargar patas');
		expect(body).not.toContain('<form');
	});

	it('grouping: search, results with Agregar links, picked bonds and the combined preview', () => {
		const body = renderPage({ mode: 'grouping' });
		expect(body).toContain('method="GET"');
		expect(body).toContain(`<input type="hidden" name="selected" value="${A}"`);
		expect(body).toContain(
			`href="/campaigns/${CAMPAIGN_ID}/bonds/pata/new?mode=grouping&amp;selected=${A}&amp;selected=${B}&amp;selected=${C}"`
		);
		expect(body).toContain('X-1');
		expect(body).toContain(`<input type="hidden" name="memberBondIds" value="${B}"`);
		expect(body).toContain(
			`action="?/group&amp;mode=grouping&amp;selected=${A}&amp;selected=${B}"`
		);
		expect(body).toContain('4881');
		expect(body).toContain('4882');
		expect(body).toContain(formatMoney('120000.00'));
		expect(submitTag(body, 'Crear pata')).not.toBe('');
		expect(isDisabled(submitTag(body, 'Crear pata'))).toBe(false);
	});

	it('grouping: cannot create with fewer than 2 bonds or with a bond that cannot be grouped', () => {
		const few = renderPage({
			mode: 'grouping',
			grouping: grouping({ selected: [member(A, '0010', '4881')], unitCount: 1 })
		});
		expect(few).toContain('Una pata necesita al menos 2 bonos simples');
		expect(isDisabled(submitTag(few, 'Crear pata'))).toBe(true);

		const grouped = renderPage({
			mode: 'grouping',
			grouping: grouping({
				selected: [
					member(A, '0010', '4881'),
					member(B, '0011', '4882', 'Ya pertenece a una pata. Desagrupar esa pata primero.')
				]
			})
		});
		expect(grouped).toContain('Ya pertenece a una pata');
		expect(grouped).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/${PATA}"`);
		expect(isDisabled(submitTag(grouped, 'Crear pata'))).toBe(true);
	});

	it('grouping: shows server errors on the picked bonds with links to their pata', () => {
		const body = renderPage({
			mode: 'grouping',
			form: {
				form: 'group',
				success: false,
				message: 'Corregir los campos marcados.',
				errors: {
					memberBondIds: ['Bono 0010: Ya pertenece a una pata. Desagrupar esa pata primero.']
				},
				conflicts: [{ field: 'memberBondIds', bondId: PATA, numbers: ['0010'] }],
				values: { internalCode: '', barcode: '' }
			}
		});
		expect(body).toContain('Bono 0010: Ya pertenece a una pata.');
		expect(body).toContain('Ver la pata a la que pertenece el bono 0010');
	});

	it('grouping: explains a malformed search', () => {
		const body = renderPage({
			mode: 'grouping',
			grouping: grouping({
				searchError: '«x» no es un número base válido (usar hasta 4 dígitos).',
				results: []
			})
		});
		expect(body).toContain('no es un número base válido');
		expect(body).toContain('No hay bonos simples disponibles para agrupar');
	});
});

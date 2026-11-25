import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import BaseNumberPreview from '$lib/components/bonds/BaseNumberPreview.svelte';
import { previewBaseNumber } from '$lib/domain/bond-preview';
import type { Campaign } from '$lib/domain/campaigns';
import { DEFAULT_NUMBERING_CONFIG } from '$lib/domain/numbering';
import Page from './+page.svelte';

const CAMPAIGN_ID = 'f0000000-0000-0000-0000-000000000001';
const BOND_ID = 'b0000000-0000-0000-0000-000000000001';
const OTHER_BOND_ID = 'b0000000-0000-0000-0000-000000000002';

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
		associatedNumberMode: 'linear',
		overflowPolicy: 'reject',
		barcodeMode: 'base_number',
		barcodePattern: null,
		createdBy: null,
		createdAt: '2026-11-17T10:00:00+00:00',
		updatedAt: '2026-11-17T10:00:00+00:00',
		...overrides
	};
}

function renderPage(
	loaded: Campaign,
	form: Record<string, unknown> | null = null,
	lockedMessage: string | null = null
) {
	const data = { campaign: loaded, canLoad: lockedMessage === null, lockedMessage };
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal PageProps for SSR
	const props = { data, form, params: { id: loaded.id } } as any;
	return render(Page, { props }).body;
}

const inputValue = (body: string, name: string) =>
	body.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0].match(/value="([^"]*)"/)?.[1];

/** Opening tag of the submit button with the given intent value. */
const submitButton = (body: string, value: string) =>
	body.match(new RegExp(`<button[^>]*name="intent"[^>]*value="${value}"[^>]*>`))?.[0] ?? '';

/** The `disabled` attribute itself, not the `disabled:` Tailwind variants in `class`. */
const isDisabled = (tag: string) => /\sdisabled=""/.test(tag);

describe('BaseNumberPreview', () => {
	const html = (input: string, config = DEFAULT_NUMBERING_CONFIG) =>
		render(BaseNumberPreview, { props: { preview: previewBaseNumber(input, config) } }).body;

	it('shows the padded base and associated numbers', () => {
		const body = html('68');
		expect(body).toContain('0068');
		expect(body).toContain('4939');
		expect(body).toContain('aria-live="polite"');
	});

	it('works for a 5-digit campaign', () => {
		const body = html('68', {
			numberDigits: 5,
			maxNumber: 99999,
			associatedNumberOffset: 48710,
			associatedNumberMode: 'linear',
			overflowPolicy: 'reject'
		});
		expect(body).toContain('00068');
		expect(body).toContain('48778');
	});

	it('explains an overflow or a malformed number', () => {
		expect(html('5129')).toContain(
			'su número asociado 10000 supera el número máximo de la campaña 9999'
		);
		expect(html('12345')).toContain('no es un número válido (usar hasta 4 dígitos)');
	});

	it('invites to type when empty', () => {
		expect(html('')).toContain('Ingresar el número base');
	});
});

describe('/campaigns/[id]/bonds/new page', () => {
	it('renders the entry form with "Guardar y cargar otro" as the default (first) submit button', () => {
		const body = renderPage(campaign());
		const buttons = [...body.matchAll(/<button[^>]*name="intent"[^>]*value="(\w+)"/g)].map(
			(m) => m[1]
		);
		expect(buttons).toEqual(['another', 'save']);
		expect(body).toContain('Guardar y cargar otro');
		expect(body).toMatch(/<input[^>]*name="baseNumber"[^>]*required/);
		expect(body).toContain('name="internalCode"');
		expect(body).toContain('name="barcode"');
		// Usable range from the numbering preview.
		expect(body).toContain('0000–5128');
		expect(body).not.toContain('Guardar el primer bono congela sus reglas');
		// Both buttons are enabled.
		for (const value of ['another', 'save']) {
			const tag = submitButton(body, value);
			expect(isDisabled(tag)).toBe(false);
		}
	});

	it('warns that the first bond freezes the rules of a draft', () => {
		expect(renderPage(campaign({ status: 'draft' }))).toContain(
			'Guardar el primer bono congela sus reglas'
		);
	});

	it('shows an explanation instead of the form when the campaign is locked', () => {
		const message =
			'Los bonos solo se pueden cargar o modificar mientras la campaña es un borrador o está activa. La campaña está cerrada.';
		const body = renderPage(campaign({ status: 'closed' }), null, message);
		expect(body).toContain('No se pueden cargar bonos');
		expect(body).toContain(message);
		expect(body).not.toContain('<form');
	});

	it('confirms the bond just saved with "Guardar y cargar otro", with an empty form', () => {
		const body = renderPage(campaign(), {
			form: 'create',
			success: true,
			message: 'Bono 0068 / 4939 guardado.',
			errors: {},
			created: { id: BOND_ID, baseFormatted: '0068', associatedFormatted: '4939' }
		});
		expect(body).toContain('Bono 0068 / 4939 guardado.');
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/${BOND_ID}"`);
		expect(body).toContain('Guardados desde esta página');
		expect(inputValue(body, 'baseNumber')).toBe('');
	});

	it('shows a duplicate with the formatted numbers and a link to the bond using them', () => {
		const body = renderPage(campaign(), {
			form: 'create',
			success: false,
			message: 'Corregir los campos marcados.',
			errors: {
				baseNumber: ['Los números 0068, 4939 ya están en uso en otro bono de esta campaña.']
			},
			conflicts: [{ field: 'baseNumber', bondId: OTHER_BOND_ID, numbers: ['0068', '4939'] }],
			values: { baseNumber: '0068', internalCode: '', barcode: '' }
		});
		expect(inputValue(body, 'baseNumber')).toBe('0068');
		expect(body).toContain('Los números 0068, 4939 ya están en uso en otro bono de esta campaña.');
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/${OTHER_BOND_ID}"`);
		expect(body).toContain('Ver el bono que usa 0068, 4939');
		expect(body).toMatch(/aria-describedby="baseNumber-preview[^"]*baseNumber-error"/);
	});

	it('shows a form-level error (campaign status changed meanwhile)', () => {
		const body = renderPage(campaign(), {
			form: 'create',
			success: false,
			message:
				'Los bonos solo se pueden cargar o modificar mientras la campaña es un borrador o está activa.',
			errors: {},
			values: { baseNumber: '0068', internalCode: '', barcode: '' }
		});
		expect(body).toContain('role="alert"');
		expect(body).toContain('Los bonos solo se pueden cargar o modificar');
	});

	it('flags an overflow live and disables saving', () => {
		const body = renderPage(campaign(), {
			form: 'create',
			success: false,
			message: 'Corregir los campos marcados.',
			errors: { baseNumber: ['El número base 5129 desborda'] },
			values: { baseNumber: '5129', internalCode: '', barcode: '' }
		});
		expect(body).toContain('el número base más alto permitido es 5128');
		expect(isDisabled(submitButton(body, 'another'))).toBe(true);
		expect(isDisabled(submitButton(body, 'save'))).toBe(true);
	});
});

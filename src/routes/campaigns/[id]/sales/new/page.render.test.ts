/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';

const id = 'f0000000-0000-0000-0000-000000000001';
const ada = {
	id: 'b',
	type: 'individual',
	firstName: 'Ada',
	lastName: 'Lovelace',
	documentNumber: '30111222'
};
const bond = (over: Record<string, unknown> = {}) => ({
	id: 'bond-1',
	kind: 'simple',
	baseNumbers: [57],
	associatedNumbers: [5057],
	commercialStatus: 'delivered_to_collector',
	collectorId: 'col',
	collectorName: 'Jorge Medina',
	totalValue: '60000.00',
	commercialUnitCount: 1,
	sellable: true,
	reason: null,
	...over
});
function page(form: any = null, data: Record<string, unknown> = {}) {
	return render(Page, {
		props: {
			data: {
				campaign: {
					id,
					name: 'Campaign',
					numberDigits: 4,
					simpleBondValue: '60000.00',
					installmentCount: 10,
					installmentValue: '6000.00'
				},
				bondQuery: '',
				found: null,
				buyers: [ada],
				buyerSearch: '',
				buyerTotal: 31,
				canCreateBuyer: true,
				today: '2027-01-01',
				saleDateBounds: { min: '2026-03-01', max: '2026-12-01' },
				firstDueDateBounds: { min: '2026-12-01', max: '2027-12-01' },
				...data
			},
			form,
			params: { id }
		} as never
	}).body;
}
const text = (html: string) =>
	html
		.replace(/<!--.*?-->/g, '')
		.replace(/<[^>]+>/g, ' ')
		.replaceAll('\u00a0', ' ')
		.replace(/\s+/g, ' ');

describe('sale registration page', () => {
	it('opens with the three steps: the bond, the buyer and the payment', () => {
		const body = page();
		for (const step of ['bond', 'buyer', 'payment']) expect(body).toContain(`data-step="${step}"`);
		expect(body).toContain('action="?/lookup"');
		expect(body).toContain('Crear un comprador');
		expect(body).toContain('Confirmar venta');
		expect(body).not.toContain('firstDueDate');
		// Buyers are listed under the search field, not in a select.
		expect(body).toContain('Lovelace, Ada');
		expect(body).toContain('30111222');
		expect(body).not.toContain('<select name="buyerId"');
		expect(body).toContain('Se muestran 1 de 31: buscar para acotar.');
		// Nothing left of numbered headings or placeholders.
		expect(body).not.toMatch(/\d\. (Buscar|Comprador|Modalidad|Vista)/);
		expect(body).not.toContain('Unknown');
	});

	it('a bond that came found (`?bond=`) is answered: one line, the collector by name, the plan', () => {
		const body = page(null, { bondQuery: '57', found: [bond()] });
		expect(body).toContain('data-chosen-bond');
		expect(text(body)).toContain('0057 Lo tiene Jorge Medina');
		expect(body).toContain('Cambiar el bono');
		// The answer travels in the sale's form, and the button names the bond.
		expect(body).toMatch(/<input[^>]*type="hidden"[^>]*name="bondId"[^>]*value="bond-1"/);
		expect(text(body)).toContain('Confirmar venta del bono 0057');
		expect(text(body)).toContain('Un pago');
		expect(text(body)).toContain('$ 60.000');
		// A collector the role cannot read is not named, and never «Unknown».
		const unnamed = text(page(null, { found: [bond({ collectorName: null })] }));
		expect(unnamed).toContain('Entregado a un cobrador');
		expect(unnamed).not.toContain('Unknown');
	});

	it('several bonds, or one that cannot be sold, stay as a choice that belongs to the sale’s form', () => {
		const body = page(null, {
			found: [bond(), bond({ id: 'bond-2', baseNumbers: [58], associatedNumbers: [] })]
		});
		expect(body).not.toContain('data-chosen-bond');
		// Without JavaScript the radios still post with the sale: they name its form.
		expect(
			body.match(/<input[^>]*type="radio"[^>]*name="bondId"[^>]*form="sale-form"/g)
		).toHaveLength(2);
		const refused = text(
			page(null, { found: [bond({ sellable: false, reason: 'Ya está vendido.' })] })
		);
		expect(refused).toContain('El bono 0057 no se puede vender: Ya está vendido.');
		expect(text(page({ form: 'lookup', found: [] }))).toContain('Ningún bono coincide');
	});

	it('a search that leaves one buyer chooses it; the button names the bond and the buyer', () => {
		const body = page(null, { found: [bond()], buyerSearch: 'love', buyerTotal: 1 });
		expect(body).toContain('data-chosen-buyer');
		expect(body).toMatch(/<input[^>]*type="hidden"[^>]*name="buyerId"[^>]*value="b"/);
		expect(text(body)).toContain('Confirmar venta del bono 0057 a Lovelace, Ada');
		// The buyers' radios belong to the sale's form too.
		expect(page()).toMatch(/<input[^>]*type="radio"[^>]*name="buyerId"[^>]*form="sale-form"/);
	});

	it('keeps what was chosen when the sale comes back with errors', () => {
		const body = page(
			{
				form: 'sale',
				message: 'Revisar los campos marcados.',
				values: {
					bondId: 'bond-1',
					buyerId: 'b',
					paymentMode: 'installments',
					firstDueDate: '2027-02-01',
					saleDate: '2026-11-20'
				},
				errors: { firstDueDate: ['Elegir una fecha válida.'] }
			},
			{ found: [bond()] }
		);
		expect(body).toContain('data-chosen-bond');
		expect(body).toContain('data-chosen-buyer');
		expect(body).toContain('Revisar los campos marcados.');
		expect(body).toContain('Elegir una fecha válida.');
		expect(body).toMatch(
			/name="saleDate"[^>]*value="2026-11-20"|value="2026-11-20"[^>]*name="saleDate"/
		);
		expect(text(body)).toContain('10 cuotas');
	});

	it('renders field errors with their accessible descriptions', () => {
		const body = page({
			form: 'sale',
			errors: {
				bondId: ['Elegir un bono entregado.'],
				buyerId: ['Elegir un comprador.'],
				firstDueDate: ['Bad date.']
			}
		});
		expect(body).toContain('bondId-error');
		expect(body).toContain('aria-describedby="buyerId-error"');
		expect(body).toContain('id="buyerId-error"');
		expect(body).not.toContain('firstDueDate-error');
	});

	it('renders the buyer duplicate warning with the form open', () => {
		const body = page({
			form: 'buyer',
			duplicates: [{ id: 'b', name: 'Ada' }],
			message: 'Duplicate'
		});
		expect(body).toContain('Duplicate');
		expect(body).toMatch(/<details[^>]*\sopen/);
	});
});

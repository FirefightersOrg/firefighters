import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';

const id = 'f0000000-0000-0000-0000-000000000001';
const COLLECTOR_ID = 'c0000000-0000-0000-0000-000000000001';
const buyer = {
	id: 'b0000000-0000-0000-0000-000000000001',
	type: 'individual' as 'individual' | 'business',
	firstName: 'Ada',
	lastName: 'Lovelace',
	businessName: null as string | null,
	documentNumber: '123',
	taxId: null as string | null,
	phone: null as string | null,
	address: null,
	usualCollectorId: null as string | null,
	notes: null,
	createdBy: null,
	createdAt: '',
	updatedAt: '',
	bondCount: 2 as number | null
};
function page(
	buyers = [buyer],
	query = { q: '', type: '' },
	pagination = { page: 1, pageSize: 25, total: buyers.length, pageCount: 1 },
	can = { manage: true, bondCounts: true }
) {
	return render(Page, {
		props: {
			data: {
				campaign: { id, name: 'Campaign', status: 'draft' },
				buyers,
				collectors: [{ id: COLLECTOR_ID, displayName: 'Héctor Acosta' }],
				query,
				pagination,
				can
			},
			form: null,
			params: { id }
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal PageProps for SSR
		} as any
	}).body;
}
const text = (body: string) =>
	body
		.replace(/<!--.*?-->/g, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ');

describe('buyers page', () => {
	it('renders a buyer and its record link', () => {
		const body = page();
		expect(body).toContain('Lovelace, Ada');
		expect(body).toContain(`href="/campaigns/${id}/buyers/${buyer.id}"`);
		// The name is the link: no separate column for it.
		expect(body).toMatch(
			new RegExp(`<a[^>]*href="/campaigns/${id}/buyers/${buyer.id}"[^>]*>Lovelace, Ada</a>`)
		);
		expect(text(body)).toContain('Mostrando 1–1 de 1 comprador');
		// Below 720px the row is stacked instead of scrolled sideways.
		expect(body).toContain('data-stack="true"');
	});

	it('the phone is a link that dials it; a buyer without one has no link', () => {
		const body = page([{ ...buyer, phone: '2364 55-4865' }]);
		expect(body).toMatch(/<a[^>]*href="tel:2364554865"[^>]*>2364 55-4865<\/a>/);
		// 44px on a phone.
		expect(body).toMatch(/<a[^>]*href="tel:2364554865"[^>]*class="[^"]*min-h-touch/);
		expect(page()).not.toContain('href="tel:');
	});

	it('says how many bonds of the campaign the buyer has, when the role reads bonds', () => {
		expect(text(page())).toContain('2 bonos');
		expect(text(page([{ ...buyer, bondCount: 1 }]))).toContain('1 bono ');
		expect(text(page([{ ...buyer, bondCount: 0 }]))).toContain('Sin bonos');
		const withoutBonds = text(
			page([{ ...buyer, bondCount: null }], undefined, undefined, {
				manage: true,
				bondCounts: false
			})
		);
		expect(withoutBonds).not.toMatch(/bonos?\b/i);
	});

	it('a 60-character business name is the row’s link, whole', () => {
		const name = 'Cooperativa de Provisión de Servicios Eléctricos de Chacabuco';
		const body = page([{ ...buyer, type: 'business', businessName: name, taxId: '30-1' }]);
		expect(body).toMatch(new RegExp(`<a[^>]*\\[overflow-wrap:anywhere\\][^>]*>${name}</a>`));
		expect(text(body)).toContain('Empresa');
	});

	it('names the usual collector, in Spanish when the role cannot read it', () => {
		expect(text(page([{ ...buyer, usualCollectorId: COLLECTOR_ID }]))).toContain('Héctor Acosta');
		const hidden = text(
			page([{ ...buyer, usualCollectorId: 'c0000000-0000-0000-0000-000000000009' }])
		);
		expect(hidden).toContain('Sin acceso al cobrador');
		expect(hidden).not.toMatch(/Unknown|undefined/);
	});

	it('an empty list says what to do', () => {
		const none = text(page([]));
		expect(none).toContain('Todavía no hay compradores');
		expect(none).toContain('Se cargan al registrar una venta, o antes con «Nuevo comprador».');
		const filtered = page([], { q: 'zzz', type: '' });
		expect(text(filtered)).toContain('Ningún comprador coincide con la búsqueda');
		expect(filtered).toMatch(
			new RegExp(`<a[^>]*href="/campaigns/${id}/buyers"[^>]*>[\\s\\S]*?Ver todos los compradores`)
		);
		expect(text(page([], undefined, { page: 4, pageSize: 25, total: 30, pageCount: 2 }))).toContain(
			'No hay compradores en esta página'
		);
	});

	it('is a GET form with the search first and the type folded, refilled', () => {
		const body = page([buyer], { q: 'Ada', type: 'business' });
		expect(body).toMatch(/<form[^>]*method="GET"/);
		expect(body).toMatch(/<input[^>]*name="q"[^>]*value="Ada"/);
		expect(body).toMatch(/<details[\s\S]*<select[^>]*name="type"/);
		expect(text(body)).toContain('Nombre, teléfono o documento');
		expect(body).toMatch(
			new RegExp(
				`<a[^>]*href="/campaigns/${id}/buyers\\?q=Ada"[^>]*aria-label="Quitar el filtro Tipo: Empresa"`
			)
		);
	});

	it('keeps filters in pagination links', () => {
		const body = page(
			[buyer],
			{ q: 'Ada Lovelace', type: 'individual' },
			{
				page: 2,
				pageSize: 25,
				total: 75,
				pageCount: 3
			}
		);
		expect(body).toContain('q=Ada%20Lovelace&amp;type=individual');
		expect(body).toContain('page=3');
		expect(body).toContain('Página 2 de 3');
		expect(body).toContain('← Anterior');
	});
});

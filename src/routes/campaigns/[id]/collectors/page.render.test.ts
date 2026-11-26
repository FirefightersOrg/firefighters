import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';
import { CAMPAIGN_ID, campaignRow } from '../../test-helpers';

const COLLECTOR_ID = 'c0000000-0000-0000-0000-000000000001';

function collector(overrides: Record<string, unknown> = {}) {
	return {
		id: COLLECTOR_ID,
		displayName: 'Héctor Acosta',
		phone: '2364 58-3149',
		email: null,
		address: null,
		userProfileId: null,
		status: 'active',
		createdBy: null,
		createdAt: '2026-11-18T00:00:00Z',
		updatedAt: '2026-11-18T00:00:00Z',
		assignedBonds: 35,
		balance: '30000.00',
		...overrides
	};
}

function page(
	options: {
		collectors?: ReturnType<typeof collector>[];
		query?: { q: string; status: string };
		total?: number;
		pageNumber?: number;
		manage?: boolean;
		balances?: boolean;
	} = {}
) {
	const collectors = options.collectors ?? [collector()];
	const total = options.total ?? collectors.length;
	return render(Page, {
		props: {
			data: {
				campaign: { id: CAMPAIGN_ID, name: campaignRow().name },
				collectors,
				pagination: {
					total,
					page: options.pageNumber ?? 1,
					pageCount: Math.max(1, Math.ceil(total / 25)),
					pageSize: 25
				},
				query: options.query ?? { q: '', status: '' },
				can: { manage: options.manage ?? false, balances: options.balances ?? true }
			},
			form: null,
			params: { id: CAMPAIGN_ID }
		} as never
	}).body;
}
const text = (body: string) =>
	body
		.replace(/<!--.*?-->/g, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ');

describe('/campaigns/[id]/collectors page', () => {
	it('each row is the collector, the bonds assigned to them and their balance', () => {
		const body = page();
		// The name is the link to the record.
		expect(body).toMatch(
			new RegExp(
				`<a[^>]*href="/campaigns/${CAMPAIGN_ID}/collectors/${COLLECTOR_ID}"[^>]*>Héctor Acosta</a>`
			)
		);
		expect(text(body)).toContain('35 bonos');
		expect(text(body)).toMatch(/A favor del cobrador \$\s30\.000/);
		expect(body).toContain('href="tel:2364583149"');
		expect(text(body)).toContain('Mostrando 1–1 de 1 cobrador');
		// Below 720px the row is stacked instead of scrolled sideways.
		expect(body).toContain('data-stack="true"');
		expect(body).toContain('max-[719px]:');
	});

	it('says the balance in words, never with a sign', () => {
		const owes = text(page({ collectors: [collector({ balance: '-3500.00' })] }));
		expect(owes).toMatch(/A cargo del cobrador \$\s3\.500/);
		expect(owes).not.toMatch(/[-−]\s?\$|\$\s?[-−]|menos/);
		const none = text(page({ collectors: [collector({ balance: '0.00', assignedBonds: 0 })] }));
		expect(none).toContain('Sin saldo');
		expect(none).toContain('Sin bonos');
	});

	it('leaves the balance out for a role that does not read it', () => {
		const body = text(page({ balances: false, collectors: [collector({ balance: null })] }));
		expect(body).not.toMatch(/Saldo|Sin saldo|A favor|A cargo/);
		expect(body).toContain('35 bonos');
	});

	it('marks an inactive collector with a badge in words', () => {
		expect(text(page({ collectors: [collector({ status: 'inactive' })] }))).toContain('Inactivo');
	});

	it('is a GET form with the search first and the status folded, refilled', () => {
		const body = page({ query: { q: 'Acosta', status: 'active' } });
		expect(body).toMatch(/<form[^>]*method="GET"/);
		expect(body).toMatch(/<input[^>]*name="q"[^>]*value="Acosta"/);
		expect(body).toMatch(/<details[\s\S]*<select[^>]*name="status"/);
		expect(text(body)).toContain('Nombre, teléfono o correo');
		// What is applied is a chip that removes it and keeps the search.
		expect(body).toMatch(
			new RegExp(
				`<a[^>]*href="/campaigns/${CAMPAIGN_ID}/collectors\\?q=Acosta"[^>]*aria-label="Quitar el filtro Estado: Activo"`
			)
		);
		expect(body).toContain('Quitar todos');
	});

	it('keeps the search and the status in the page links', () => {
		const body = page({ query: { q: 'Ana Paz', status: 'inactive' }, total: 75, pageNumber: 2 });
		expect(body).toContain(
			`href="/campaigns/${CAMPAIGN_ID}/collectors?q=Ana%20Paz&amp;status=inactive&amp;page=3"`
		);
		expect(body).toContain(
			`href="/campaigns/${CAMPAIGN_ID}/collectors?q=Ana%20Paz&amp;status=inactive"`
		);
		expect(text(body)).toContain('Página 2 de 3');
	});

	it('an empty list says what to do', () => {
		const none = text(page({ collectors: [], manage: true }));
		expect(none).toContain('Todavía no hay cobradores');
		expect(none).toContain('Cargar el primero con «Nuevo cobrador»');
		expect(text(page({ collectors: [] }))).toContain('Los carga quien administra el sistema.');

		const filtered = page({ collectors: [], query: { q: 'zzz', status: '' } });
		expect(text(filtered)).toContain('Ningún cobrador coincide con la búsqueda');
		expect(filtered).toMatch(
			new RegExp(
				`<a[^>]*href="/campaigns/${CAMPAIGN_ID}/collectors"[^>]*>[\\s\\S]*?Ver todos los cobradores`
			)
		);

		const beyond = page({ collectors: [], total: 30, pageNumber: 5 });
		expect(text(beyond)).toContain('No hay cobradores en esta página');
		expect(text(beyond)).toContain('Ir a la primera página');
	});

	it('shows Nuevo cobrador only to collector managers', () => {
		expect(page()).not.toContain('Nuevo cobrador');
		expect(page({ manage: true })).toContain(`href="/campaigns/${CAMPAIGN_ID}/collectors/new"`);
	});
});

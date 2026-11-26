import { describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import CampaignShell from './CampaignShell.svelte';

const ID = 'f0000000-0000-0000-0000-000000000001';
const HOME = `/campaigns/${ID}`;
const children = createRawSnippet(() => ({ render: () => '<h1>Contenido de la página</h1>' }));

const STAFF = [
	'campaign.view',
	'bond.view',
	'sale.view',
	'settlement.view',
	'collector.view',
	'buyer.view',
	'draw.view',
	'report.view_operational',
	'commission.view',
	'audit.view',
	'report.export'
];

function shell(
	props: Partial<{
		permissions: string[];
		pathname: string;
		openSettlements: number | null;
		fullName: string | null;
	}> = {}
) {
	return render(CampaignShell, {
		props: {
			institution: 'Bomberos Voluntarios',
			campaign: { id: ID, name: 'Bono Contribución 2026' },
			fullName: 'Laura Quiroga',
			permissions: STAFF,
			pathname: `${HOME}/sales`,
			openSettlements: null,
			children,
			...props
		}
	}).body;
}
const flat = (body: string) =>
	body
		.replace(/<!--.*?-->/g, '')
		.replace(/[ \t\r\n]+/g, ' ')
		.replace(/> </g, '><');
/** The markup of the element that carries `marker` (a data attribute), up to its closing tag. */
const region = (body: string, marker: string, tag: string) => {
	const start = body.indexOf(marker);
	const open = body.lastIndexOf(`<${tag}`, start);
	return body.slice(open, body.indexOf(`</${tag}>`, start));
};

describe('CampaignShell: top bar', () => {
	it('names the institution and the campaign in one link to the campaign home', () => {
		const body = flat(shell());
		expect(body).toMatch(
			new RegExp(
				`<a href="${HOME}"[^>]*>.*?bg-brand.*?Bomberos Voluntarios.*?Bono Contribución 2026.*?</a>`
			)
		);
		expect(body).not.toContain('Firefighters');
		// The brand red appears once: the institution mark.
		expect(body.match(/bg-brand/g)).toHaveLength(1);
	});

	it('has the bond search as a GET to the bonds list, for whoever can see bonds', () => {
		const body = shell();
		expect(body).toMatch(
			new RegExp(`<form method="GET" action="${HOME}/bonds" role="search" aria-label="Buscar bono"`)
		);
		expect(body).toMatch(/<input[^>]*name="base"[^>]*inputmode="numeric"/);
		expect(shell({ permissions: ['campaign.view', 'sale.view'] })).not.toContain('role="search"');
	});

	it('leaves the search out on the campaign page, which opens with its own', () => {
		expect(shell({ pathname: HOME })).not.toContain('role="search"');
	});

	it('offers a skip link to the content, which can take focus', () => {
		const body = shell();
		expect(body).toMatch(/<a href="#contenido"[^>]*>Ir al contenido<\/a>/);
		expect(body).toMatch(/<main id="contenido" tabindex="-1"/);
		expect(body).toContain('Contenido de la página');
		expect(body.indexOf('Ir al contenido')).toBeLessThan(body.indexOf('<header'));
	});

	it('shows the person and the way out', () => {
		const body = shell();
		expect(body).toContain('Laura Quiroga');
		expect(body).toMatch(/<form method="POST" action="\/logout"/);
	});
});

describe('CampaignShell: the rail (desktop)', () => {
	const rail = (body: string) => region(body, 'data-campaign-rail', 'nav');

	it('lists the sections by group, from navigation.ts', () => {
		const body = rail(shell());
		expect(body).toContain('aria-label="Secciones de la campaña"');
		for (const text of ['Operación', 'Personas', 'Sorteos y reportes', 'Administración'])
			expect(body).toContain(text);
		for (const section of ['bonds', 'sales', 'settlements', 'collectors', 'draws', 'reports'])
			expect(body).toContain(`href="${HOME}/${section}"`);
		expect(body).toContain(`href="${HOME}/configuracion"`);
		expect(body).toContain('hidden lg:');
	});

	it('shows only what the permissions allow', () => {
		const body = rail(shell({ permissions: ['campaign.view', 'bond.view'] }));
		expect(body).toContain(`href="${HOME}/bonds"`);
		expect(body).not.toContain(`href="${HOME}/settlements"`);
		expect(body).not.toContain(`href="${HOME}/collectors"`);
		expect(body).not.toContain('Personas');
		expect(body).not.toContain(`href="${HOME}/audit"`);
	});

	it('marks the current section with aria-current, the yellow bar and weight 600', () => {
		const body = rail(shell({ pathname: `${HOME}/sales/new` }));
		expect(body.match(/aria-current="page"/g)).toHaveLength(1);
		expect(body).toMatch(new RegExp(`href="${HOME}/sales" aria-current="page"`));
		expect(body).toContain('aria-[current=page]:border-accent');
		expect(body).toContain('aria-[current=page]:font-semibold');
	});

	it('says how many settlements are open, in words for a screen reader', () => {
		expect(flat(rail(shell({ openSettlements: 3 })))).toMatch(
			/Rendiciones<span[^>]*>3<span class="sr-only"> ?abiertas<\/span>/
		);
		expect(flat(rail(shell({ openSettlements: 1 })))).toMatch(
			/>1<span class="sr-only"> ?abierta<\/span>/
		);
		expect(rail(shell({ openSettlements: 0 }))).not.toContain('abierta');
		expect(rail(shell({ openSettlements: null }))).not.toContain('abierta');
	});

	it('ends with the way to another campaign, and the portal for whoever has one', () => {
		expect(rail(shell())).toContain('href="/campaigns"');
		expect(rail(shell())).not.toContain('href="/portal"');
		expect(rail(shell({ permissions: [...STAFF, 'bond.view_own'] }))).toContain('href="/portal"');
	});
});

describe('CampaignShell: the tab bar (phone)', () => {
	const tabs = (body: string) => region(body, 'data-campaign-tabs', 'nav');

	it('has four section tabs and «Más», each 56px tall, and is hidden from 1024px', () => {
		const body = tabs(shell());
		expect(body).toContain('aria-label="Secciones de la campaña, barra inferior"');
		expect(body).toContain('lg:hidden');
		const list = body.slice(0, body.indexOf('data-campaign-more'));
		expect(list.match(/<a /g)).toHaveLength(4);
		expect(list.match(/<button/g)).toHaveLength(1);
		expect(list.match(/min-h-14/g)).toHaveLength(5);
		for (const label of ['Inicio', 'Bonos', 'Ventas', 'Rendiciones', 'Más'])
			expect(list).toContain(label);
	});

	it('marks the current tab with aria-current and the yellow bar', () => {
		const list = tabs(shell({ pathname: `${HOME}/sales` }));
		expect(list).toMatch(
			new RegExp(`href="${HOME}/sales" aria-current="page" class="[^"]*border-accent font-semibold`)
		);
	});

	it('keeps the other sections under «Más», closed until asked for', () => {
		const body = tabs(shell());
		expect(body).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-controls="[^"]+-more"/);
		const more = body.slice(body.indexOf('data-campaign-more'));
		expect(body).toMatch(/<div id="[^"]+-more"[^>]*hidden/);
		for (const section of ['deliveries', 'collectors', 'buyers', 'draws', 'reports', 'audit'])
			expect(more).toContain(`href="${HOME}/${section}"`);
		expect(more).not.toContain(`href="${HOME}/bonds"`);
		expect(more).toContain('Cambiar de campaña');
		expect(more).toContain('Cerrar sesión');
		expect(more.match(/min-h-touch/g)!.length).toBeGreaterThanOrEqual(8);
	});

	it('says so on «Más» when the current section is one of those under it', () => {
		const current = flat(tabs(shell({ pathname: `${HOME}/draws` })));
		expect(current).toMatch(/Más<span class="sr-only"> ?, sección actual<\/span>/);
		expect(flat(tabs(shell({ pathname: `${HOME}/sales` })))).not.toContain('sección actual');
	});

	it('gives a role with fewer sections fewer tabs, never an empty bar', () => {
		const list = tabs(shell({ permissions: ['campaign.view'], pathname: HOME }));
		const before = list.slice(0, list.indexOf('data-campaign-more'));
		expect(before.match(/<a /g)).toHaveLength(1);
		expect(before).toContain('Más');
	});
});

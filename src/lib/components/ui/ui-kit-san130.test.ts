import { describe, expect, it, vi } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import Table from './Table.svelte';
import Dialog from './Dialog.svelte';
import PageHeader from './PageHeader.svelte';
import AppHeader from './AppHeader.svelte';

const html = (s: string) => createRawSnippet(() => ({ render: () => s }));

type Row = { id: number; code: string; name: string; amount: number };
const rows: Row[] = [
	{ id: 1, code: '0457', name: 'Ana', amount: 1200 },
	{ id: 2, code: '0458', name: 'Beto', amount: 30 }
];
const columns = [
	{ key: 'code', header: 'Código', mono: true },
	{ key: 'name', header: 'Nombre' },
	{ key: 'amount', header: 'Monto', align: 'right' as const, render: (r: Row) => `$ ${r.amount}` }
];

describe('Table', () => {
	it('renders semantic markup with caption and column headers', () => {
		const { body } = render(Table, { props: { columns, rows, caption: 'Registros' } });
		expect(body).toContain('<caption');
		expect(body).toContain('Registros');
		expect(body.match(/<th[^>]*scope="col"/g)).toHaveLength(3);
		expect(body).toContain('$ 1200');
		expect(body.match(/<tr/g)).toHaveLength(3);
	});

	it('right-aligns numeric columns with tabular numbers and uses mono for codes', () => {
		const { body } = render(Table, { props: { columns, rows } });
		const tds = body.match(/<td[^>]*>/g) ?? [];
		expect(tds[0]).toContain('font-mono');
		expect(tds[2]).toContain('text-right');
		expect(tds[2]).toContain('tabular-nums');
	});

	it('marks the selected row and supports compact density', () => {
		const { body } = render(Table, {
			props: { columns, rows, selectedKey: 2, density: 'compact' }
		});
		expect(body.match(/data-selected="true"/g)).toHaveLength(1);
		expect(body).toContain('data-density="compact"');
		expect(body).toContain('py-1.5');
	});

	it('honors rowKey and maxHeight', () => {
		const keyed = rows.map((r) => ({ ...r, code2: `k${r.id}` }));
		const { body } = render(Table, {
			props: { columns, rows: keyed, rowKey: 'code2', selectedKey: 'k1', maxHeight: '300px' }
		});
		expect(body.match(/data-selected="true"/g)).toHaveLength(1);
		expect(body).toContain('max-height: 300px');
	});

	it('renders the empty slot, or a default message, when there are no rows', () => {
		const withSlot = render(Table, {
			props: { columns, rows: [], empty: html('<p>Nada por aquí</p>') }
		}).body;
		expect(withSlot).toContain('Nada por aquí');
		expect(withSlot).toContain('colspan="3"');
		expect(render(Table, { props: { columns, rows: [] } }).body).toContain('Sin resultados');
	});

	it('scrolls inside its own container', () => {
		const { body } = render(Table, { props: { columns, rows } });
		expect(body).toMatch(/^<!--[^>]*-->\s*<div[^>]*overflow-x-auto/);
	});
});

describe('Dialog', () => {
	const base = {
		open: false,
		onClose: vi.fn(),
		title: '¿Anular 3 registros?',
		confirmLabel: 'Anular'
	};

	it('is a native dialog named by its title and described by its description', () => {
		const { body } = render(Dialog, { props: { ...base, description: 'No se puede deshacer.' } });
		const dialog = body.match(/<dialog[^>]*>/)?.[0] ?? '';
		const titleId = dialog.match(/aria-labelledby="([^"]+)"/)?.[1];
		const descId = dialog.match(/aria-describedby="([^"]+)"/)?.[1];
		expect(titleId).toBeTruthy();
		expect(body).toContain(`<h2 id="${titleId}"`);
		expect(body).toContain(`<p id="${descId}"`);
		expect(body).toContain('¿Anular 3 registros?');
	});

	it('confirm is a submit button inside a form (works with SvelteKit actions)', () => {
		const { body } = render(Dialog, { props: { ...base, action: '?/annul' } });
		expect(body).toMatch(/<form[^>]*method="POST"[^>]*action="\?\/annul"/i);
		expect(body).toMatch(/<button[^>]*type="submit"[^>]*data-dialog-confirm/);
		expect(body).toContain('Cancelar');
	});

	it('danger tone focuses Cancelar first and styles confirm as danger', () => {
		const { body } = render(Dialog, { props: { ...base, tone: 'danger' } });
		const cancel = body.match(/<button[^>]*data-dialog-cancel[^>]*>/)?.[0] ?? '';
		const confirm = body.match(/<button[^>]*data-dialog-confirm[^>]*>/)?.[0] ?? '';
		expect(cancel).toContain('autofocus');
		expect(confirm).toContain('bg-danger');
		const neutral = render(Dialog, { props: base }).body;
		expect(neutral.match(/<button[^>]*data-dialog-cancel[^>]*>/)?.[0]).not.toContain('autofocus');
	});

	it('disables confirm while loading or when confirmDisabled, and reports busy', () => {
		const loading = render(Dialog, { props: { ...base, loading: true } }).body;
		const confirm = loading.match(/<button[^>]*data-dialog-confirm[^>]*>/)?.[0] ?? '';
		expect(confirm).toContain('disabled');
		expect(confirm).toContain('aria-busy="true"');
		const blocked = render(Dialog, { props: { ...base, confirmDisabled: true } }).body;
		expect(blocked.match(/<button[^>]*data-dialog-confirm[^>]*>/)?.[0]).toContain('disabled');
	});

	it('uses full-width stacked buttons on mobile, custom labels and extra fields', () => {
		const { body } = render(Dialog, {
			props: {
				...base,
				cancelLabel: 'Volver',
				children: html('<textarea name="reason"></textarea>')
			}
		});
		expect(body).toContain('flex-col-reverse');
		expect(body.match(/<button[^>]*w-full/g)).toHaveLength(2);
		expect(body).toContain('Volver');
		expect(body).toContain('<textarea name="reason">');
	});
});

describe('PageHeader', () => {
	it('renders a single h1, description and actions', () => {
		const { body } = render(PageHeader, {
			props: {
				title: 'Campañas',
				description: 'Todas las campañas.',
				actions: html('<a>Nueva</a>')
			}
		});
		expect(body.match(/<h1/g)).toHaveLength(1);
		expect(body).toContain('Campañas');
		expect(body).toContain('Todas las campañas.');
		expect(body).toContain('<a>Nueva</a>');
	});

	it('renders breadcrumbs with the last crumb as current page, unlinked', () => {
		const { body } = render(PageHeader, {
			props: {
				title: 'Detalle',
				breadcrumbs: [{ label: 'Campañas', href: '/campaigns' }, { label: 'Rifa 2026' }]
			}
		});
		expect(body).toContain('aria-label="Ruta de navegación"');
		expect(body).toContain('href="/campaigns"');
		expect(body).toMatch(/<span aria-current="page">Rifa 2026<\/span>/);
		expect(body).not.toContain('Inicio');
	});

	it('omits optional regions', () => {
		const { body } = render(PageHeader, { props: { title: 'Solo título' } });
		expect(body).not.toContain('<nav');
		expect(body).not.toContain('<p');
	});
});

describe('AppHeader', () => {
	const links = [
		{ label: 'Campañas', href: '/campaigns', current: true },
		{ label: 'Compradores', href: '/buyers' },
		{ label: 'Importaciones', href: '/imports' }
	];

	it('renders product, nav with aria-current and the user', () => {
		const { body } = render(AppHeader, {
			props: { product: 'Bomberos', homeHref: '/home', links, user: 'Ana Pérez' }
		});
		expect(body).toContain('href="/home"');
		expect(body).toContain('Bomberos');
		expect(body).toContain('Ana Pérez');
		expect(body).toContain('aria-label="Principal"');
		expect(body.match(/aria-current="page"/g)).toHaveLength(2); // desktop + mobile menu
		expect(body).toContain('href="/buyers"');
	});

	it('has a labelled menu button wired to a collapsed menu', () => {
		const { body } = render(AppHeader, { props: { product: 'X', links } });
		const button = body.match(/<button[^>]*aria-expanded[^>]*>/)?.[0] ?? '';
		const controls = button.match(/aria-controls="([^"]+)"/)?.[1];
		expect(button).toContain('aria-label="Menú"');
		expect(button).toContain('aria-expanded="false"');
		expect(button).toContain('min-[720px]:hidden');
		expect(body).toMatch(new RegExp(`<div id="${controls}"[^>]*hidden`));
		expect(body).toContain('min-h-touch');
	});

	it('shows «Cerrar sesión» as a POST form, or custom userActions', () => {
		const logout = render(AppHeader, {
			props: { product: 'X', user: 'Ana', logoutAction: '/logout' }
		}).body;
		expect(logout).toMatch(/<form[^>]*method="POST"[^>]*action="\/logout"/i);
		expect(logout).toContain('Cerrar sesión');
		const custom = render(AppHeader, {
			props: { product: 'X', userActions: html('<button>Salir ya</button>'), logoutAction: '/l' }
		}).body;
		expect(custom).toContain('Salir ya');
		expect(custom).not.toContain('Cerrar sesión');
	});

	it('without links there is no nav or menu button', () => {
		const { body } = render(AppHeader, { props: { product: 'X' } });
		expect(body).not.toContain('<nav');
		expect(body).not.toContain('aria-expanded');
	});
});

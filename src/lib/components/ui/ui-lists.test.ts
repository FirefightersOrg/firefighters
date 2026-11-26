import { describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import FilterBar from './FilterBar.svelte';
import Row from './Row.svelte';
import RowActions from './RowActions.svelte';
import RowList from './RowList.svelte';
import SegmentedControl from './SegmentedControl.svelte';
import Table from './Table.svelte';
import TaskBar from './TaskBar.svelte';
import * as ui from './index';

const html = (value: string) => createRawSnippet(() => ({ render: () => value }));
const flat = (body: string) =>
	body
		.replace(/<!--.*?-->/g, '')
		.replace(/[ \t\r\n]+/g, ' ')
		.replace(/> </g, '><');

describe('SegmentedControl', () => {
	const options = [
		{ value: 'cash', label: 'Efectivo' },
		{ value: 'transfer', label: 'Transferencia' }
	];

	it('is a group of native radios that share a name, so arrows move and the form posts it', () => {
		const body = render(SegmentedControl, {
			props: { legend: 'Medio de pago', name: 'paymentMethod', options, value: 'cash' }
		}).body;
		expect(body.match(/type="radio"/g)).toHaveLength(2);
		expect(body.match(/name="paymentMethod"/g)).toHaveLength(2);
		expect(body).toMatch(/<fieldset[^>]*>/);
		expect(body).toContain('>Medio de pago</legend>');
		expect(body).toMatch(/value="cash"[^>]*checked/);
		expect(body).not.toMatch(/value="transfer"[^>]*checked/);
	});

	it('starts from defaultValue when it is not bound', () => {
		const body = render(SegmentedControl, {
			props: { legend: 'Modalidad', options, defaultValue: 'transfer' }
		}).body;
		expect(body).toMatch(/value="transfer"[^>]*checked/);
	});

	it('marks the choice with a check as well as the fill, and has 44px targets on touch', () => {
		const body = render(SegmentedControl, { props: { legend: 'Medio', options } }).body;
		expect(body).toContain('peer-checked:block');
		expect(body).toContain('has-checked:bg-primary');
		expect(body).toContain('pointer-coarse:min-h-touch');
		expect(body).toContain('has-focus-visible:outline-focus');
	});

	it('can hide its legend visually without losing the group name', () => {
		const body = render(SegmentedControl, {
			props: { legend: 'Medio de pago', options, hideLegend: true }
		}).body;
		expect(body).toMatch(/<legend class="sr-only">Medio de pago<\/legend>/);
	});

	it('disables one option or the whole group', () => {
		const one = render(SegmentedControl, {
			props: { legend: 'x', options: [options[0], { ...options[1], disabled: true }] }
		}).body;
		expect(one.match(/disabled/g)?.length).toBeGreaterThanOrEqual(1);
		expect(
			render(SegmentedControl, { props: { legend: 'x', options, disabled: true } }).body
		).toMatch(/<fieldset[^>]*disabled/);
	});
});

describe('RowList and Row', () => {
	it('is a named list', () => {
		const body = render(RowList, {
			props: { label: 'Pagos de esta rendición', children: html('<li>x</li>') }
		}).body;
		expect(body).toMatch(/<ul[^>]*aria-label="Pagos de esta rendición"/);
	});

	it('shows the empty content instead of an empty list', () => {
		const body = render(RowList, {
			props: { label: 'Pagos', children: html('<li>x</li>'), empty: html('<p>Sin pagos</p>') }
		}).body;
		expect(body).toContain('Sin pagos');
		expect(body).not.toContain('<ul');
	});

	it('makes the whole row one link when it has an href', () => {
		const body = render(Row, {
			props: { title: 'Patricia Rodríguez', detail: 'Pago total, efectivo', href: '/sales/1' }
		}).body;
		expect(body.match(/<a\b/g)).toHaveLength(1);
		expect(body).toMatch(/<a[^>]*href="\/sales\/1"[^>]*after:absolute after:inset-0/);
		expect(body).toContain('min-h-14');
		expect(body).toContain('Pago total, efectivo');
	});

	it('is plain text without an href', () => {
		const body = render(Row, { props: { title: 'Cuota 3 de 6' } }).body;
		expect(body).not.toMatch(/<a\b/);
		expect(body).toContain('Cuota 3 de 6');
	});

	it('keeps row actions above the row link', () => {
		const body = flat(
			render(Row, {
				props: { title: 'x', href: '/a', actions: html('<button>…</button>') }
			}).body
		);
		expect(body).toMatch(/<div class="relative z-\[1\] shrink-0"><button>…<\/button><\/div>/);
	});

	it('places the lead before the text and the trailing content after it', () => {
		const body = flat(
			render(Row, {
				props: {
					title: 'Daniel Luna',
					lead: html('<b>0003</b>'),
					trailing: html('<i>$ 10.000</i>'),
					meta: html('<em>Vencida</em>')
				}
			}).body
		);
		expect(body.indexOf('0003')).toBeLessThan(body.indexOf('Daniel Luna'));
		expect(body.indexOf('Daniel Luna')).toBeLessThan(body.indexOf('$ 10.000'));
		expect(body).toContain('<em>Vencida</em>');
	});
});

describe('RowActions', () => {
	const actions = [
		{ label: 'Corregir el medio de pago' },
		{ label: 'Quitar de la rendición', tone: 'danger' as const },
		{ label: 'Ver comprobante', href: '/payments/1/print' }
	];

	it('is one named control per row, closed by default', () => {
		const body = render(RowActions, {
			props: { label: 'Acciones del pago del bono 0019', actions }
		}).body;
		expect(body).toMatch(/<summary[^>]*aria-label="Acciones del pago del bono 0019"/);
		expect(body).toMatch(/<summary[^>]*aria-expanded="false"/);
		expect(body).not.toMatch(/<details[^>]* open/);
		expect(body).toContain('size-touch');
	});

	it('lists buttons and links, with the destructive one marked', () => {
		const body = render(RowActions, { props: { label: 'Acciones', actions } }).body;
		expect(body.match(/<button\b/g)).toHaveLength(2);
		expect(body).toMatch(/<a[^>]*href="\/payments\/1\/print"/);
		expect(body).toMatch(/text-danger-text[^>]*>Quitar de la rendición/);
		expect(body.match(/min-h-touch/g)).toHaveLength(3);
	});
});

describe('FilterBar', () => {
	const base = {
		action: '/campaigns/c/bonds',
		searchName: 'base',
		searchLabel: 'Número de bono'
	};

	it('is a GET search form with the search field first', () => {
		const body = render(FilterBar, {
			props: { ...base, searchValue: '181', inputmode: 'numeric' }
		}).body;
		expect(body).toMatch(/<form[^>]*method="GET"[^>]*action="\/campaigns\/c\/bonds"/);
		expect(body).toContain('role="search"');
		expect(body).toMatch(/<input[^>]*name="base"/);
		expect(body).toMatch(/<input[^>]*value="181"/);
		expect(body).toContain('inputmode="numeric"');
		expect(body).toContain('Número de bono');
		expect(body).toMatch(/<button[^>]*type="submit"/);
	});

	it('folds the other filters, closed by default, with their own submit', () => {
		const filters = html('<label>Estado <select name="status"></select></label>');
		const closed = render(FilterBar, { props: { ...base, filters } }).body;
		expect(closed).toMatch(/<details[^>]*>/);
		expect(closed).not.toMatch(/<details[^>]* open/);
		expect(closed).toContain('name="status"');
		expect(closed).toContain('Aplicar filtros');
		expect(render(FilterBar, { props: { ...base, filters, open: true } }).body).toMatch(
			/<details[^>]* open/
		);
	});

	it('has no «Filtrar» block when the list only has the search', () => {
		expect(render(FilterBar, { props: base }).body).not.toContain('<details');
	});

	it('shows what is applied as removable chips, with their count and a way to clear them', () => {
		const body = render(FilterBar, {
			props: {
				...base,
				filters: html('<i></i>'),
				applied: [
					{ label: 'Estado: Vendido', removeHref: '/campaigns/c/bonds?base=1' },
					{ label: 'Tipo: Pata', removeHref: '/campaigns/c/bonds?status=sold' }
				],
				clearHref: '/campaigns/c/bonds'
			}
		}).body;
		expect(body).toContain('aria-label="Filtros aplicados"');
		expect(body).toContain('aria-label="Quitar el filtro Estado: Vendido"');
		expect(body).toMatch(/href="\/campaigns\/c\/bonds\?status=sold"/);
		expect(flat(body)).toMatch(/data-filter-count="">2 ?<span class="sr-only">filtros aplicados/);
		expect(body).toMatch(/<a[^>]*href="\/campaigns\/c\/bonds"[^>]*>Quitar todos/);
	});

	it('shows no chips when nothing is applied', () => {
		expect(render(FilterBar, { props: base }).body).not.toContain('Filtros aplicados');
	});
});

describe('TaskBar', () => {
	it('is a named region, fixed on phones and a block on desktop, with room left under the page', () => {
		const body = render(TaskBar, {
			props: {
				label: 'Cierre de la rendición',
				children: html('<b>$ 63.000</b>'),
				action: html('<button>Revisar y cerrar</button>')
			}
		}).body;
		expect(body).toMatch(/role="region"[^>]*aria-label="Cierre de la rendición"/);
		expect(body).toContain('fixed');
		expect(body).toContain('min-[1024px]:static');
		expect(body).toContain('env(safe-area-inset-bottom)');
		expect(body).toMatch(/data-taskbar-spacer/);
		expect(body).toContain('Revisar y cerrar');
	});
});

describe('Table: containment and the stacked phone layout', () => {
	const columns = [
		{ key: 'bond', header: 'Bono', stack: 'primary' as const },
		{ key: 'amount', header: 'Importe', align: 'right' as const, stack: 'trailing' as const },
		{ key: 'buyer', header: 'Comprador', stack: 'secondary' as const },
		{ key: 'due', header: 'Vence' },
		{ key: 'code', header: 'Código', stack: 'hidden' as const }
	];
	const rows = [
		{ id: '1', bond: '0181', amount: '$ 10.000', buyer: 'Stella', due: '22/08', code: 'x' }
	];

	it('holds its absolutely positioned descendants, so they cannot widen the page', () => {
		const body = render(Table, { props: { columns, rows } }).body;
		expect(body).toMatch(/<div[^>]*class="relative overflow-x-auto/);
	});

	it('is an ordinary table unless stack is asked for', () => {
		const body = render(Table, { props: { columns, rows } }).body;
		expect(body).not.toContain('max-[719px]');
		expect(body).not.toContain('role="table"');
		expect(body).not.toContain('data-label');
	});

	it('keeps table semantics when stacked, by naming every role', () => {
		const body = render(Table, { props: { columns, rows, stack: true, caption: 'Bonos' } }).body;
		expect(body).toMatch(/<table[^>]*role="table"/);
		expect(body.match(/role="rowgroup"/g)).toHaveLength(2);
		expect(body.match(/role="row"/g)).toHaveLength(2);
		expect(body.match(/role="columnheader"/g)).toHaveLength(5);
		expect(body.match(/role="cell"/g)).toHaveLength(5);
		// The header row stays for screen readers, hidden from view on phones.
		expect(body).toMatch(/<thead[^>]*class="max-\[719px\]:sr-only"/);
	});

	it('lays each row out in lines by the role of its columns', () => {
		const body = render(Table, { props: { columns, rows, stack: true } }).body;
		const cell = (text: string) =>
			body.match(new RegExp(`<td[^>]*>(?:<!--.*?-->|\\s)*${text.replace('$', '\\$')}`))?.[0] ?? '';
		expect(cell('0181')).toContain('max-[719px]:row-start-1');
		expect(cell('0181')).toContain('max-[719px]:col-start-1');
		expect(cell('$ 10.000')).toContain('max-[719px]:col-start-2');
		expect(cell('Stella')).toContain('max-[719px]:text-muted');
		expect(cell('x')).toContain('max-[719px]:hidden');
		// A column with no role follows as a line labelled with its header.
		expect(cell('22/08')).toContain('data-label="Vence"');
		expect(cell('22/08')).toContain('max-[719px]:before:content-[attr(data-label)');
		expect(cell('0181')).not.toContain('data-label');
	});

	it('stacks the empty state too', () => {
		const body = render(Table, { props: { columns, rows: [], stack: true } }).body;
		expect(body).toContain('Sin resultados.');
		expect(body).toMatch(/<td[^>]*role="cell"[^>]*colspan="5"/);
	});
});

describe('barrel', () => {
	it('exports the list components', () => {
		for (const name of ['RowList', 'Row', 'RowActions', 'FilterBar', 'SegmentedControl', 'TaskBar'])
			expect(ui).toHaveProperty(name);
	});
});

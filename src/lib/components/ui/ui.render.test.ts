import { describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import Alert from './Alert.svelte';
import Badge from './Badge.svelte';
import Card from './Card.svelte';
import Disclosure from './Disclosure.svelte';
import EmptyState from './EmptyState.svelte';
import Section from './Section.svelte';
import Stat from './Stat.svelte';
import Toast from './Toast.svelte';
import { TOAST_TIMEOUT_MS, toastTimeout } from './toast';
import * as ui from './index';

const text = (value: string) => createRawSnippet(() => ({ render: () => `<span>${value}</span>` }));

describe('Badge', () => {
	it('renders the word and a decorative dot by default', () => {
		const { body } = render(Badge, { props: { tone: 'success', children: text('Activa') } });
		expect(body).toContain('Activa');
		expect(body).toContain('data-tone="success"');
		expect(body).toContain('aria-hidden="true"');
	});

	it('defaults to neutral and drops the dot with dot={false}', () => {
		const { body } = render(Badge, { props: { dot: false, children: text('Categoría') } });
		expect(body).toContain('data-tone="neutral"');
		expect(body).not.toContain('aria-hidden');
	});

	it('is not interactive', () => {
		const { body } = render(Badge, { props: { children: text('x') } });
		expect(body).not.toMatch(/<(button|a)\b/);
	});
});

describe('Alert', () => {
	it('announces danger immediately with role="alert"', () => {
		const { body } = render(Alert, { props: { tone: 'danger', children: text('Falló') } });
		expect(body).toContain('role="alert"');
	});

	it.each(['info', 'success', 'warning'] as const)('uses role="status" for %s', (tone) => {
		const { body } = render(Alert, { props: { tone, children: text('Aviso') } });
		expect(body).toContain('role="status"');
		expect(body).not.toContain('role="alert"');
	});

	it('renders title, body and actions; dismiss only with onDismiss', () => {
		const withAll = render(Alert, {
			props: {
				title: 'Título',
				children: text('Cuerpo'),
				actions: text('Reintentar'),
				onDismiss: () => {}
			}
		}).body;
		expect(withAll).toContain('Título');
		expect(withAll).toContain('Cuerpo');
		expect(withAll).toContain('Reintentar');
		expect(withAll).toContain('aria-label="Cerrar aviso"');

		const bare = render(Alert, { props: { children: text('Cuerpo') } }).body;
		expect(bare).not.toContain('Cerrar aviso');
	});
});

describe('Toast', () => {
	it('renders inside a polite live region', () => {
		const { body } = render(Toast, { props: { children: text('Cambios guardados') } });
		expect(body).toContain('role="status"');
		expect(body).toContain('aria-live="polite"');
		expect(body).toContain('Cambios guardados');
		expect(body).toContain('fixed');
	});

	it('inline renders in the flow, with action and close button', () => {
		const { body } = render(Toast, {
			props: {
				inline: true,
				tone: 'info',
				children: text('Nueva versión disponible'),
				action: text('Recargar'),
				onDismiss: () => {}
			}
		});
		expect(body).not.toContain('fixed');
		expect(body).toContain('data-tone="info"');
		expect(body).toContain('Recargar');
		expect(body).toContain('aria-label="Cerrar aviso"');
	});

	it('auto-dismisses after 5 s unless it has an action', () => {
		expect(TOAST_TIMEOUT_MS).toBe(5000);
		expect(toastTimeout(false)).toBe(5000);
		expect(toastTimeout(true)).toBeNull();
	});
});

describe('EmptyState', () => {
	it('renders the title, guidance and action', () => {
		const { body } = render(EmptyState, {
			props: {
				title: 'Todavía no hay importaciones',
				children: text('Subir un CSV'),
				actions: text('Importar')
			}
		});
		expect(body).toContain('Todavía no hay importaciones');
		expect(body).toContain('Subir un CSV');
		expect(body).toContain('Importar');
	});
});

describe('Card', () => {
	it('renders header, body and footer, and links the title', () => {
		const { body } = render(Card, {
			props: {
				id: 'datos',
				title: 'Datos',
				description: 'Resumen',
				actions: text('Editar'),
				footer: text('Guardar'),
				children: text('Contenido')
			}
		});
		expect(body).toContain('<section');
		expect(body).toContain('aria-labelledby="datos-title"');
		expect(body).toContain('id="datos-title"');
		for (const part of ['Datos', 'Resumen', 'Editar', 'Guardar', 'Contenido']) {
			expect(body).toContain(part);
		}
		expect(body).toContain('p-4');
	});

	it('flush removes the body padding; `as` changes the element', () => {
		const { body } = render(Card, {
			props: { as: 'article', flush: true, children: text('Tabla') }
		});
		expect(body).toContain('<article');
		expect(body).not.toContain('p-4');
	});
});

describe('Section', () => {
	it('is a numbered, anchored, labelled region', () => {
		const { body } = render(Section, {
			props: { id: 'barcode', number: 3, title: 'Código de barras', children: text('x') }
		});
		expect(body).toContain('id="barcode"');
		expect(body).toContain('aria-labelledby="barcode-title"');
		expect(body).toContain('3.');
		expect(body).toContain('Código de barras');
	});

	it('omits the number when none is given', () => {
		const { body } = render(Section, { props: { id: 'a', title: 'T', children: text('x') } });
		expect(body).not.toContain('tabular-nums">');
	});
});

describe('Stat', () => {
	it('renders label, value and detail', () => {
		const { body } = render(Stat, {
			props: { label: 'Recaudado', value: '$ 1.284.500', detail: '+8 % vs. octubre' }
		});
		expect(body).toContain('Recaudado');
		expect(body).toContain('$ 1.284.500');
		expect(body).toContain('+8 % vs. octubre');
	});
});

describe('Disclosure', () => {
	it('is a <details> with summary, meta and aria-expanded', () => {
		const { body } = render(Disclosure, {
			props: { summary: 'Historial', meta: '3 eventos', children: text('Detalle') }
		});
		expect(body).toContain('<details');
		expect(body).toContain('<summary');
		expect(body).toContain('aria-expanded="false"');
		expect(body).toContain('Historial');
		expect(body).toContain('3 eventos');
		expect(body).not.toMatch(/<details[^>]* open/);
	});

	it('defaultOpen starts expanded', () => {
		const { body } = render(Disclosure, {
			props: { summary: 'Historial', defaultOpen: true, children: text('Detalle') }
		});
		expect(body).toMatch(/<details[^>]* open/);
		expect(body).toContain('aria-expanded="true"');
	});
});

describe('index', () => {
	it('exports every SAN-129 component', () => {
		for (const name of [
			'Badge',
			'Alert',
			'Toast',
			'EmptyState',
			'Card',
			'Section',
			'Stat',
			'Disclosure',
			'StatusBadge'
		]) {
			expect(ui, name).toHaveProperty(name);
		}
	});
});

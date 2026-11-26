import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import ErrorMessage from './ErrorMessage.svelte';

const back = [
	{ label: 'Volver a Bonos', href: '/campaigns/c/bonds' },
	{ label: 'Ir al inicio de la campaña', href: '/campaigns/c' }
];
const page = (status: number, error: Record<string, string> | null) =>
	render(ErrorMessage, { props: { status, error, retryHref: '/campaigns/c/bonds/x?y=1', back } })
		.body;

describe('ErrorMessage', () => {
	it('403: one heading in Spanish, the status, and the way back as the main action', () => {
		const body = page(403, {
			message: 'Forbidden',
			code: 'permission_denied',
			permission: 'settlement.view'
		});
		expect(body.match(/<h1/g)).toHaveLength(1);
		expect(body).toContain('Sin acceso a esta sección');
		expect(body).toContain('Esta sección es de tesorería.');
		expect(body).toContain('Error 403');
		expect(body).not.toContain('Forbidden');
		expect(body).not.toContain('Volver a intentar');
		// The first way back is the primary button; nothing to retry on a denial.
		expect(body).toMatch(/href="\/campaigns\/c\/bonds"[^>]*class="[^"]*bg-primary/);
		expect(body).toContain('href="/campaigns/c"');
	});

	it('404: says what was not found', () => {
		const body = page(404, { message: 'Venta no encontrada.' });
		expect(body).toContain('No se encontró');
		expect(body).toContain('Venta no encontrada.');
		expect(body).not.toContain('Not Found');
	});

	it('500: announces the failure and offers the same address again first', () => {
		const body = page(500, { message: 'No se pudo cargar la campaña. Volver a intentar.' });
		expect(body).toContain('role="alert"');
		expect(body).toMatch(/href="\/campaigns\/c\/bonds\/x\?y=1"[^>]*class="[^"]*bg-primary/);
		expect(body.indexOf('Volver a intentar</')).toBeLessThan(body.indexOf('Volver a Bonos'));
	});

	it('does not announce a denial or a missing record as an alert', () => {
		expect(page(403, null)).not.toContain('role="alert"');
		expect(page(404, null)).not.toContain('role="alert"');
	});
});

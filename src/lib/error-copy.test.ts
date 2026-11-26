import { describe, expect, it } from 'vitest';
import { GENERIC_ERROR_MESSAGE } from './copy';
import { areaOf, errorCopy } from './error-copy';

const denied = (permission: string) => ({
	message: 'Forbidden',
	code: 'permission_denied',
	permission
});

describe('areaOf', () => {
	it.each([
		['settlement.view', 'tesorería'],
		['payment.create', 'tesorería'],
		['commission.view', 'tesorería'],
		['collector.ledger.view', 'tesorería'],
		['report.view_financial', 'tesorería'],
		['audit.view', 'administración'],
		['user.manage', 'administración'],
		['campaign.create', 'administración'],
		['draw.create', 'administración'],
		['bond.create', 'operación'],
		['bond.assign', 'operación'],
		['sale.create', 'operación'],
		['collector.manage', 'operación'],
		['buyer.manage', 'operación']
	])('%s belongs to %s', (permission, area) => {
		expect(areaOf(permission)).toBe(area);
	});

	it("is null for a permission that is not one area's, and for none", () => {
		for (const permission of ['campaign.view', 'bond.view', 'collector.view', 'buyer.view'])
			expect(areaOf(permission)).toBeNull();
		expect(areaOf(undefined)).toBeNull();
		expect(areaOf(null)).toBeNull();
	});
});

describe('errorCopy', () => {
	it("403: says whose section it is, never the server's English word", () => {
		const copy = errorCopy(403, denied('settlement.view'));
		expect(copy.title).toBe('Sin acceso a esta sección');
		expect(copy.body).toContain('Esta sección es de tesorería.');
		expect(copy.body).toContain('pedir el acceso');
		expect(copy.retry).toBe(false);
		expect(JSON.stringify(copy)).not.toContain('Forbidden');
	});

	it("403: falls back to a general sentence when the permission is not one area's", () => {
		const copy = errorCopy(403, denied('collector.view'));
		expect(copy.body).toBe(
			'El usuario no tiene permiso para ver esta sección. Pedir el acceso a quien administra el sistema.'
		);
		expect(errorCopy(403, null).body).toContain('no tiene permiso');
	});

	it('403: keeps a message the server wrote for people', () => {
		expect(errorCopy(403, { message: 'No hay permiso para ver este certificado.' }).body).toBe(
			'No hay permiso para ver este certificado.'
		);
	});

	it('404: names what was not found when the server said so, and where to go', () => {
		const named = errorCopy(404, { message: 'Sorteo no encontrado.' });
		expect(named.title).toBe('No se encontró');
		expect(named.body).toBe('Sorteo no encontrado. Revisar la dirección o volver a la lista.');
		expect(named.retry).toBe(false);
		for (const message of ['Not Found', 'Not found', undefined])
			expect(errorCopy(404, message ? { message } : null).body).toBe(
				'La dirección no existe o el registro ya no está. Revisar la dirección o volver a la lista.'
			);
	});

	it('500: says it could not load and offers to try again', () => {
		const copy = errorCopy(500, { message: 'No se pudo cargar la campaña. Volver a intentar.' });
		expect(copy.title).toBe('No se pudo cargar');
		expect(copy.body).toBe('No se pudo cargar la campaña. Volver a intentar.');
		expect(copy.retry).toBe(true);
		for (const message of ['Internal Error', 'Error', 'Error: 500', undefined])
			expect(errorCopy(500, message ? { message } : undefined).body).toBe(GENERIC_ERROR_MESSAGE);
		expect(errorCopy(503, null).retry).toBe(true);
	});

	it('401: asks to sign in again', () => {
		expect(errorCopy(401, null).title).toBe('Hace falta iniciar sesión');
	});

	it('never has an exclamation mark, and always ends its sentences', () => {
		for (const status of [401, 403, 404, 500, 503]) {
			const copy = errorCopy(status, denied('audit.view'));
			expect(copy.body).not.toMatch(/[!¡]/);
			expect(copy.body.endsWith('.')).toBe(true);
		}
	});
});

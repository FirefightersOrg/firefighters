/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';

/**
 * New delivery (UX plan PR 16). The ranges are built in the browser from what the lookup returns, so
 * they are covered by `delivery-summary.test.ts` and the E2E; this checks what the server renders.
 */
describe('new delivery', () => {
	const body = (form: unknown = null) =>
		render(Page, {
			props: {
				data: {
					campaign: {
						id: 'c',
						name: 'Campaign',
						numberDigits: 4,
						maxNumber: 9999,
						associatedNumberOffset: 5000,
						associatedNumberMode: 'linear',
						overflowPolicy: 'reject'
					},
					canDeliver: true,
					lockedMessage: null,
					canSeeCollectors: true,
					collectors: [
						{ id: 'c0000000-0000-4000-8000-000000000001', displayName: 'Jorge Medina' },
						{ id: 'c0000000-0000-4000-8000-000000000002', displayName: 'Raúl Sosa' }
					]
				},
				form
			} as any
		}).body;

	it('posts the collector, the notes and the bonds with the delivery, though they are apart on the page', () => {
		const html = body();
		// The collector is chosen first, outside the form, and still belongs to it.
		expect(html).toMatch(/<select[^>]*name="collectorId"[^>]*form="deliver-form"/);
		expect(html).toMatch(/<form[^>]*id="deliver-form"[^>]*action="\?\/deliver"/);
		expect(html.indexOf('name="collectorId"')).toBeLessThan(html.indexOf('action="?/lookup"'));
		expect(html.indexOf('action="?/lookup"')).toBeLessThan(html.indexOf('id="deliver-form"'));
		expect(html).toMatch(/<input[^>]*name="notes"/);
		// The ids the scanner flow and the tests use.
		for (const id of ['query', 'from', 'to', 'collectorId', 'notes'])
			expect(html).toContain(`id="${id}"`);
	});

	it('with no bonds the button says «Entregar bonos» and is not available', () => {
		const html = body();
		expect(html).toContain('Todavía no hay bonos en esta entrega.');
		expect(html).toMatch(
			/<button(?=[^>]*data-deliver-submit)(?=[^>]*\sdisabled)[^>]*type="submit"/
		);
		expect(html).toMatch(/data-deliver-submit[^>]*>[\s\S]*?Entregar bonos\s*</);
		expect(html).not.toContain('Entregar y emitir remito');
	});

	it('a rejected delivery comes back with its collector, named on the button, and its errors', () => {
		const html = body({
			success: false,
			message: 'Revisar los campos marcados.',
			errors: { bondIds: ['Agregar al menos un bono.'] },
			values: { collectorId: 'c0000000-0000-4000-8000-000000000002', notes: 'Para la kermés' }
		});
		expect(html).toContain('Revisar los campos marcados.');
		expect(html).toContain('Agregar al menos un bono.');
		expect(html).toContain('Entregar bonos a Raúl Sosa');
		expect(html).toContain('value="Para la kermés"');
	});
});

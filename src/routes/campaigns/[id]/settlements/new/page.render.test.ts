/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';

const page = (data: Record<string, unknown> = {}, form: unknown = null) =>
	render(Page, {
		props: {
			data: {
				campaign: { id: 'c', name: 'Campaign' },
				collectors: [{ id: 'x', displayName: 'Ana' }],
				openSettlements: [],
				forPayment: false,
				notesMax: 2000,
				...data
			},
			form,
			params: { id: 'c' }
		} as any
	}).body;

describe('new settlement render', () => {
	it('renders collector and notes fields', () => {
		const body = page();
		expect(body).toContain('Ana');
		expect(body).toContain('name="notes"');
		expect(body).toContain('Abrir rendición');
		expect(body).not.toContain('Registrar pago');
	});

	it('renders validation feedback', () => {
		expect(page({ collectors: [] }, { errors: { collectorId: ['Choose one.'] } })).toContain(
			'Choose one.'
		);
	});

	it('reached from «Registrar pago», it is worded around the payment (UX plan PR 7)', () => {
		const body = page({ forPayment: true });
		expect(body).toContain('Registrar pago');
		expect(body).toContain('Los pagos se cargan en la rendición abierta del cobrador.');
		expect(body).toContain('Abrir rendición y cargar pagos');
	});

	it('sends to the open settlement of the chosen collector instead of opening another', () => {
		const openSettlements = [{ id: 's9', collectorId: 'x', settlementNumber: 9 }];
		// The collector comes back chosen after a failed submit: the page already knows where to go.
		const body = page({ openSettlements }, { values: { collectorId: 'x' } });
		expect(body).toContain('Ana ya tiene abierta la rendición 9');
		expect(body).toContain('href="/campaigns/c/settlements/s9"');
		expect(body).toContain('Cargar pagos en la rendición 9');
		expect(body).not.toContain('name="notes"');
		// Nobody chosen yet: the form to open one.
		expect(page({ openSettlements })).not.toContain('ya tiene abierta');
	});
});

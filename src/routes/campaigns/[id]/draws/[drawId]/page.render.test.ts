/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';
const data = (status: string, type = 'monthly', legacy = false) => ({
	campaign: { id: 'c', name: 'Campaign', installmentCount: 10 },
	draw: {
		id: 'd',
		name: 'Draw',
		drawType: type,
		drawDate: '2026-12-01',
		paymentCutoffAt: '2026-11-30T00:00:00-03:00',
		requiredInstallmentNumber: 2,
		eligibilityRule: {},
		status
	},
	roster:
		status === 'scheduled' ? null : { status: status === 'roster_frozen' ? 'frozen' : 'generated' },
	hasLegacyExtras: legacy,
	reasonMax: 1000,
	can: {
		edit: status === 'scheduled',
		annul:
			status === 'scheduled' ||
			(status === 'roster_generated' && type === 'extraordinary_full_payment'),
		generate: status === 'scheduled',
		regenerate: status === 'roster_generated',
		freeze: status === 'roster_generated',
		complete: status === 'roster_frozen'
	}
});
describe('draw detail render', () => {
	it.each(['scheduled', 'roster_frozen'])(
		'hides lifecycle controls without permission on %s',
		(status) => {
			const value = data(status);
			value.can.annul = false;
			value.can.complete = false;
			const body = render(Page, { props: { data: value, form: null } as any }).body;
			expect(body).not.toContain('action="?/annul"');
			expect(body).not.toContain('action="?/complete"');
			if (status === 'scheduled') expect(body).toContain('Editar sorteo programado');
		}
	);
	it('offers generated extraordinary annulment but not ordinary or frozen annulment', () => {
		for (const [status, type, allowed] of [
			['roster_generated', 'extraordinary_full_payment', true],
			['roster_generated', 'monthly', false],
			['roster_frozen', 'extraordinary_full_payment', false]
		] as const) {
			const body = render(Page, { props: { data: data(status, type), form: null } as any }).body;
			expect(body.includes('Anular sorteo')).toBe(allowed);
			// New rosters use the bonds' own numbers (SAN-152): no extras copy.
			expect(body.includes('libera los números extra reservados')).toBe(false);
		}
	});
	it('shows the extras release copy only for legacy rosters with extras', () => {
		const body = render(Page, {
			props: {
				data: data('roster_generated', 'extraordinary_full_payment', true),
				form: null
			} as any
		}).body;
		expect(body).toContain('libera los números');
		expect(body).toContain('anterior al cambio');
	});
	it('renders scheduled actions', () => {
		const body = render(Page, { props: { data: data('scheduled'), form: null } as any }).body;
		expect(body).toContain('Editar sorteo programado');
		expect(body).toContain('Generar padrón');
		expect(body).toContain('Anular sorteo');
	});
	it('converts a UTC cutoff instant near midnight to the Buenos Aires wall clock', () => {
		const value = data('scheduled');
		value.draw.paymentCutoffAt = '2026-11-20T02:30:00+00:00';
		const body = render(Page, { props: { data: value, form: null } as any }).body;
		expect(body).toContain('19/11/2026, 23:30 (hora de Buenos Aires)');
		expect(body).toContain('value="2026-11-19T23:30"');
	});
	it('renders generated actions and consolation warning', () => {
		expect(
			render(Page, { props: { data: data('roster_generated'), form: null } as any }).body
		).toContain('Congelar padrón');
		expect(
			render(Page, { props: { data: data('scheduled', 'consolation'), form: null } as any }).body
		).toContain('premios de los sorteos anteriores');
	});
	it('offers completion only on a frozen draw (SAN-123)', () => {
		const frozen = render(Page, { props: { data: data('roster_frozen'), form: null } as any }).body;
		expect(frozen).toContain('action="?/complete"');
		expect(frozen).toContain('Todos los premios tienen que estar resueltos');
		expect(
			render(Page, { props: { data: data('roster_generated'), form: null } as any }).body
		).not.toContain('action="?/complete"');
		expect(
			render(Page, { props: { data: data('completed'), form: null } as any }).body
		).not.toContain('action="?/complete"');
	});
	it('hides actions in a terminal state', () =>
		expect(render(Page, { props: { data: data('closed'), form: null } as any }).body).not.toContain(
			'Generar padrón'
		));
});

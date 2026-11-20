/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';
const data = (status: string, type = 'monthly') => ({
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
	reasonMax: 1000,
	can: {
		edit: status === 'scheduled',
		annul: status === 'scheduled',
		generate: status === 'scheduled',
		regenerate: status === 'roster_generated',
		freeze: status === 'roster_generated'
	}
});
describe('draw detail render', () => {
	it('renders scheduled actions', () => {
		const body = render(Page, { props: { data: data('scheduled'), form: null } as any }).body;
		expect(body).toContain('Edit scheduled draw');
		expect(body).toContain('Generate roster');
		expect(body).toContain('Annul draw');
	});
	it('renders generated actions and consolation warning', () => {
		expect(
			render(Page, { props: { data: data('roster_generated'), form: null } as any }).body
		).toContain('Freeze roster');
		expect(
			render(Page, { props: { data: data('scheduled', 'consolation'), form: null } as any }).body
		).toContain('unavailable until draw results exist');
	});
	it('hides actions in a terminal state', () =>
		expect(render(Page, { props: { data: data('closed'), form: null } as any }).body).not.toContain(
			'Generate roster'
		));
});

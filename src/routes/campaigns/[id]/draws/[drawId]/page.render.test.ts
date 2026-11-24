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
	it('offers generated extraordinary annulment but not ordinary or frozen annulment', () => {
		for (const [status, type, allowed] of [
			['roster_generated', 'extraordinary_full_payment', true],
			['roster_generated', 'monthly', false],
			['roster_frozen', 'extraordinary_full_payment', false]
		] as const) {
			const body = render(Page, { props: { data: data(status, type), form: null } as any }).body;
			expect(body.includes('Annul draw')).toBe(allowed);
			expect(body.includes('releases its reserved extra numbers')).toBe(allowed);
		}
	});
	it('renders scheduled actions', () => {
		const body = render(Page, { props: { data: data('scheduled'), form: null } as any }).body;
		expect(body).toContain('Edit scheduled draw');
		expect(body).toContain('Generate roster');
		expect(body).toContain('Annul draw');
	});
	it('converts a UTC cutoff instant near midnight to the Buenos Aires wall clock', () => {
		const value = data('scheduled');
		value.draw.paymentCutoffAt = '2026-11-20T02:30:00+00:00';
		const body = render(Page, { props: { data: value, form: null } as any }).body;
		expect(body).toContain('2026-11-19 23:30 (Buenos Aires)');
		expect(body).toContain('value="2026-11-19T23:30"');
	});
	it('renders generated actions and consolation warning', () => {
		expect(
			render(Page, { props: { data: data('roster_generated'), form: null } as any }).body
		).toContain('Freeze roster');
		expect(
			render(Page, { props: { data: data('scheduled', 'consolation'), form: null } as any }).body
		).toContain('unavailable until draw results exist');
	});
	it('offers completion only on a frozen draw (SAN-123)', () => {
		const frozen = render(Page, { props: { data: data('roster_frozen'), form: null } as any }).body;
		expect(frozen).toContain('action="?/complete"');
		expect(frozen).toContain('Every prize must be resolved');
		expect(
			render(Page, { props: { data: data('roster_generated'), form: null } as any }).body
		).not.toContain('action="?/complete"');
		expect(
			render(Page, { props: { data: data('completed'), form: null } as any }).body
		).not.toContain('action="?/complete"');
	});
	it('hides actions in a terminal state', () =>
		expect(render(Page, { props: { data: data('closed'), form: null } as any }).body).not.toContain(
			'Generate roster'
		));
});

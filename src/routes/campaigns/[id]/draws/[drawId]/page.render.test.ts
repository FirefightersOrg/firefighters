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
			expect(/libera los\s+números extra/.test(body)).toBe(false);
		}
	});
	it('shows the extras release copy only for legacy rosters with extras', () => {
		const body = render(Page, {
			props: {
				data: data('roster_generated', 'extraordinary_full_payment', true),
				form: null
			} as any
		}).body;
		expect(body).toMatch(/libera los\s+números/);
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
		).toMatch(/premios de los sorteos\s+anteriores/);
	});
	it('offers completion only on a frozen draw (SAN-123)', () => {
		const frozen = render(Page, { props: { data: data('roster_frozen'), form: null } as any }).body;
		expect(frozen).toContain('action="?/complete"');
		expect(frozen).toContain('Cuando todos los premios estén resueltos');
		expect(
			render(Page, { props: { data: data('roster_generated'), form: null } as any }).body
		).not.toContain('action="?/complete"');
		expect(
			render(Page, { props: { data: data('completed'), form: null } as any }).body
		).not.toContain('action="?/complete"');
	});
	describe('the next step (UX plan PR 16)', () => {
		const body = (status: string, extra: Record<string, unknown> = {}, can = {}) => {
			const value: any = { ...data(status), ...extra };
			value.can = { ...value.can, loadWinner: true, ...can };
			return render(Page, { props: { data: value, form: null } as any }).body;
		};
		/** The step marked as current, and the text of the primary buttons and links of the page. */
		const current = (html: string) => html.match(/aria-current="step" data-step="(\w+)"/)?.[1];
		const primaries = (html: string) =>
			[...html.matchAll(/<(?:a|button)[^>]*bg-primary [^>]*>([\s\S]*?)<\/(?:a|button)>/g)].map(
				(match) => match[1].replace(/<[^>]+>/g, '').trim()
			);
		const counts = (extra: Record<string, number>) => ({
			total: 0,
			unresolved: 0,
			resolved: 0,
			pendingDelivery: 0,
			...extra
		});

		it('scheduled: generating the roster is the one primary button', () => {
			const html = body('scheduled');
			expect(current(html)).toBe('generate');
			expect(primaries(html)).toEqual(['Generar padrón']);
			expect(html).toContain('Sorteo mensual del 01/12/2026');
		});
		it('generated: freezing is the primary button, and it says it is definitive', () => {
			const html = body('roster_generated');
			expect(current(html)).toBe('freeze');
			expect(primaries(html)).toEqual(['Congelar padrón']);
			expect(html).toContain('Congelar es definitivo');
			expect(html).toContain('Regenerar padrón');
			expect(html).toContain('Ver padrón');
		});
		it('frozen with prizes waiting: the winners are the primary button, and completion is not offered', () => {
			const html = body('roster_frozen', {
				prizes: counts({ total: 2, unresolved: 1, resolved: 1 })
			});
			expect(current(html)).toBe('winners');
			expect(primaries(html)).toEqual(['Cargar ganadores']);
			expect(html).toContain('Falta resolver 1 de 2 premios.');
			expect(html).not.toContain('action="?/complete"');
			expect(html).toMatch(/href="\/campaigns\/c\/draws\/d\/winners"/);
		});
		it('frozen, read without the permission to load winners: the button says «Ver»', () => {
			const html = body('roster_frozen', { prizes: counts({}) }, { loadWinner: false });
			expect(primaries(html)).toEqual(['Ver ganadores y premios']);
		});
		it('frozen with every prize resolved: completing the draw is the primary button', () => {
			const html = body('roster_frozen', { prizes: counts({ total: 2, resolved: 2 }) });
			expect(current(html)).toBe('complete');
			expect(primaries(html)).toEqual(['Completar sorteo']);
			expect(html).toContain('Ver ganadores y premios');
		});
		it('completed: no step is current; a prize to hand over is the primary button', () => {
			const pending = body('completed', {
				prizes: counts({ total: 2, resolved: 2, pendingDelivery: 1 })
			});
			expect(current(pending)).toBeUndefined();
			expect(primaries(pending)).toEqual(['Registrar la entrega del premio']);
			const done = body('completed', { prizes: counts({ total: 2, resolved: 2 }) });
			expect(primaries(done)).toEqual([]);
			expect(done).toContain('Sorteo realizado.');
		});
		it('annulled: no steps, the reason instead', () => {
			const value: any = data('annulled');
			value.draw.annulReason = 'Se suspendió la cena';
			value.draw.annulledAt = '2026-11-20T15:00:00Z';
			const html = render(Page, { props: { data: value, form: null } as any }).body;
			expect(html).not.toContain('data-draw-steps');
			expect(html).toContain('Sorteo anulado');
			expect(html).toContain('Motivo: Se suspendió la cena');
		});
	});
	it('hides actions in a terminal state', () =>
		expect(render(Page, { props: { data: data('closed'), form: null } as any }).body).not.toContain(
			'Generar padrón'
		));
});

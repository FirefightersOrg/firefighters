/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';

const prize = (status: string, winningNumber: Record<string, unknown> | null = null) => ({
	id: `prize-${status}`,
	drawId: 'draw',
	name: 'Bike',
	description: 'Mountain bike',
	position: 1,
	status,
	excludesFromConsolation: true,
	annulReason: status === 'annulled' ? 'Wrong result' : null,
	winningNumber
});
const result = {
	id: 'winner',
	numberValue: 7,
	formattedNumber: '0007',
	resultStatus: 'eligible_winner',
	eligible: true,
	reasonLabel: null,
	bondLabel: 'B-7',
	buyerLabel: 'Fire Supplies SA',
	collectorLabel: 'Central station'
};
const data = (prizes: unknown[], can: Record<string, boolean> = {}) => ({
	campaign: { id: 'campaign', name: 'Campaign' },
	draw: { id: 'draw', name: 'December', status: 'roster_frozen' },
	prizes,
	reasonMax: 1000,
	can: {
		create: true,
		edit: true,
		loadWinner: true,
		resolve: true,
		deliver: true,
		annul: true,
		reverseDelivery: true,
		...can
	}
});

describe('winners and prizes render', () => {
	it('shows reversal only with permission and delivered state; reversed prizes cannot print', () => {
		for (const status of ['delivered', 'pending_delivery', 'annulled', 'unawarded']) {
			for (const reverseDelivery of [true, false]) {
				const body = render(Page, {
					props: { data: data([prize(status)], { reverseDelivery }), form: null } as any
				}).body;
				expect(body.includes('Revertir entrega')).toBe(status === 'delivered' && reverseDelivery);
				expect(body.includes('Imprimir constancia de entrega')).toBe(status === 'delivered');
				if (status === 'delivered' && reverseDelivery) {
					expect(body).toMatch(/name="reason"[^>]*required/);
					expect(body).not.toContain('maxlength');
				}
			}
		}
	});
	it('renders reversal feedback and preserves the submitted reason', () => {
		for (const success of [true, false]) {
			const body = render(Page, {
				props: {
					data: data([prize('delivered')]),
					form: {
						form: 'reverseDelivery',
						success,
						message: success ? 'Entrega del premio revertida.' : 'Reversal failed.',
						values: { prizeId: 'prize-delivered', reason: 'Incorrect delivery' }
					}
				} as any
			}).body;
			expect(body).toContain(success ? 'Entrega del premio revertida.' : 'Reversal failed.');
			expect(body).toContain('Incorrect delivery');
		}
	});
	it('renders state-aware configure, load, resolve, deliver and replacement actions', () => {
		const body = render(Page, {
			props: {
				data: data([
					prize('pending_validation'),
					prize('pending_validation', result),
					prize('pending_delivery', result),
					prize('delivered', result),
					prize('unawarded', result),
					prize('annulled')
				]),
				form: null
			} as any
		}).body;
		expect(body).toContain('Configurar un premio');
		expect(body).toContain('Validar contra el padrón congelado');
		expect(body).toContain('Registrar resolución');
		expect(body).toContain('Registrar entrega');
		expect(body).toContain('Un premio entregado no se puede anular.');
		expect(body).toContain('Imprimir constancia de entrega');
		expect(body).toContain('Imprimir constancia de premio no adjudicado');
		expect(body).toContain('target="_blank"');
		expect(body).toContain('Crear el reemplazo en la posición 1');
	});

	it('hides actions without capabilities', () => {
		const body = render(Page, {
			props: {
				data: data([prize('pending_validation')], {
					create: false,
					edit: false,
					loadWinner: false,
					resolve: false,
					deliver: false,
					annul: false
				}),
				form: null
			} as any
		}).body;
		expect(body).not.toContain('Configurar un premio');
		expect(body).not.toContain('Validar contra el padrón congelado');
		expect(body).not.toContain('Anular premio');
		expect(body).not.toContain('Imprimir constancia de entrega');
		expect(body).not.toContain('Imprimir constancia de premio no adjudicado');
	});

	it('renders the immediate real-shaped validation result and exact plain-language reason', () => {
		const immediate = {
			...result,
			resultStatus: 'not_eligible',
			eligible: false,
			reasonLabel: 'Bono sin pago total'
		};
		const body = render(Page, {
			props: {
				data: data([]),
				form: {
					form: 'loadWinner',
					success: true,
					message: 'Número ganador cargado.',
					result: immediate
				}
			} as any
		}).body;
		expect(body).toContain('Resultado de la validación del 0007');
		// Redesign: the winning number is drawn as the bond's stub.
		expect(body).toMatch(/>Número ganador<\/span>\s*<span[^>]*font-figure[^>]*>0007</);
		expect(body).toContain('B-7');
		expect(body).toContain('Fire Supplies SA');
		expect(body).toContain('Central station');
		expect(body).toContain('Bono sin pago total');
		expect(body).toContain('El premio queda no adjudicado.');
	});

	it('explains an unmatched number without invented snapshot data', () => {
		const body = render(Page, {
			props: {
				data: data([
					prize('unawarded', {
						...result,
						resultStatus: 'no_match',
						eligible: null,
						bondLabel: null,
						buyerLabel: null,
						collectorLabel: null,
						reasonLabel: 'el número no está en el padrón'
					})
				]),
				form: null
			} as any
		}).body;
		expect(body).toContain('el número no está en el padrón');
		expect(body).toContain('El premio queda no adjudicado.');
	});
});

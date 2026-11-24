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
				expect(body.includes('Reverse delivery')).toBe(status === 'delivered' && reverseDelivery);
				expect(body.includes('Print delivery certificate')).toBe(status === 'delivered');
				if (status === 'delivered' && reverseDelivery) {
					expect(body).toContain('name="reason" required');
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
						message: success ? 'Prize delivery reversed.' : 'Reversal failed.',
						values: { prizeId: 'prize-delivered', reason: 'Incorrect delivery' }
					}
				} as any
			}).body;
			expect(body).toContain(success ? 'Prize delivery reversed.' : 'Reversal failed.');
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
		expect(body).toContain('Configure a prize');
		expect(body).toContain('Validate against frozen roster');
		expect(body).toContain('Record resolution');
		expect(body).toContain('Record delivery');
		expect(body).toContain('Delivered prizes cannot be annulled.');
		expect(body).toContain('Print delivery certificate');
		expect(body).toContain('Print unawarded certificate');
		expect(body).toContain('target="_blank"');
		expect(body).toContain('Create replacement at position 1');
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
		expect(body).not.toContain('Configure a prize');
		expect(body).not.toContain('Validate against frozen roster');
		expect(body).not.toContain('Annul prize');
		expect(body).not.toContain('Print delivery certificate');
		expect(body).not.toContain('Print unawarded certificate');
	});

	it('renders the immediate real-shaped validation result and exact plain-language reason', () => {
		const immediate = {
			...result,
			resultStatus: 'not_eligible',
			eligible: false,
			reasonLabel: 'Bond not fully paid'
		};
		const body = render(Page, {
			props: {
				data: data([]),
				form: {
					form: 'loadWinner',
					success: true,
					message: 'Winning number loaded.',
					result: immediate
				}
			} as any
		}).body;
		expect(body).toContain('Validation result for 0007');
		expect(body).toContain('B-7');
		expect(body).toContain('Fire Supplies SA');
		expect(body).toContain('Central station');
		expect(body).toContain('Bond not fully paid');
		expect(body).toContain('The prize is unawarded.');
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
						reasonLabel: 'Number not in the roster'
					})
				]),
				form: null
			} as any
		}).body;
		expect(body).toContain('Number not in the roster');
		expect(body).toContain('The prize is unawarded.');
	});
});

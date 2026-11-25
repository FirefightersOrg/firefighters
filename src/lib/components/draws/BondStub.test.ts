import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import BondStub from './BondStub.svelte';

describe('BondStub (redesign)', () => {
	it('draws the number with the brand stripe and a single accessible name', () => {
		const body = render(BondStub, {
			props: { number: '0100', caption: 'Premio 1', detail: 'asociado 5100' }
		}).body;
		expect(body).toContain('role="img"');
		expect(body).toContain('aria-label="Premio 1: número 0100, asociado 5100"');
		expect(body).toContain('bg-brand');
		expect(body).toContain('font-figure');
		expect(body).toContain('>0100<');
	});
	it('omits the detail line when there is none', () => {
		const body = render(BondStub, { props: { number: '0007', caption: 'Número ganador' } }).body;
		expect(body).toContain('aria-label="Número ganador: número 0007"');
		expect(body).not.toContain('text-body-sm text-muted');
	});
});

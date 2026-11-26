import { describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { formatMoney } from '$lib/format';
import Badge from './Badge.svelte';
import BondNumber from './BondNumber.svelte';
import BondStub from './BondStub.svelte';
import Money from './Money.svelte';
import MoneySheet from './MoneySheet.svelte';
import * as ui from './index';

const text = (value: string) => createRawSnippet(() => ({ render: () => `<span>${value}</span>` }));
/** Collapses the whitespace Svelte keeps between tags, so assertions read like the screen. */
const flat = (html: string) =>
	html
		.replace(/<!--.*?-->/g, '')
		// Not \s: that would also swallow the non-breaking spaces the components rely on.
		.replace(/[ \t\r\n]+/g, ' ')
		.replace(/> </g, '><');

describe('BondNumber', () => {
	it('zero-pads a numeric base number to the campaign digits, in the figure face', () => {
		const { body } = render(BondNumber, { props: { number: 181 } });
		expect(body).toContain('>0181<');
		expect(body).toContain('font-figure');
		expect(body).toContain('tabular-nums');
		expect(body).toContain('whitespace-nowrap');
	});

	it('pads to the digits given and shows a string as written', () => {
		expect(render(BondNumber, { props: { number: 7, digits: 5 } }).body).toContain('>00007<');
		expect(render(BondNumber, { props: { number: '0042' } }).body).toContain('>0042<');
	});

	it('shows the associated number after the base one, smaller', () => {
		const body = flat(render(BondNumber, { props: { number: 181, associated: 5181 } }).body);
		expect(body).toMatch(/>0181<\/span><span class="[^"]*text-subtle[^"]*">\/ 5181<\/span>/);
		// The gap comes from the layout, not from a space a flex container would drop.
		expect(body).toContain('gap-1');
		expect(render(BondNumber, { props: { number: 181, associated: null } }).body).not.toContain(
			'text-subtle'
		);
	});

	it('has three sizes', () => {
		expect(render(BondNumber, { props: { number: 1, size: 'sm' } }).body).toContain('text-[16px]');
		expect(render(BondNumber, { props: { number: 1 } }).body).toContain('text-[20px]');
		expect(render(BondNumber, { props: { number: 1, size: 'lg' } }).body).toContain('text-[28px]');
	});

	it('is a link only when it gets an href, with a 44px target on phones', () => {
		const linked = render(BondNumber, {
			props: { number: 181, href: '/campaigns/c/bonds/b' }
		}).body;
		expect(linked).toMatch(/<a [^>]*href="\/campaigns\/c\/bonds\/b"/);
		expect(linked).toContain('min-h-touch');
		expect(render(BondNumber, { props: { number: 181 } }).body).not.toMatch(/<a\b/);
	});
});

describe('Money', () => {
	it('shows whole pesos on screens and keeps real cents', () => {
		expect(render(Money, { props: { value: 60000 } }).body).toContain(formatMoney(60000));
		expect(render(Money, { props: { value: '150500.00' } }).body).toContain(formatMoney(150500));
		expect(render(Money, { props: { value: '1500.50' } }).body).toContain(formatMoney('1500.50'));
		expect(render(Money, { props: { value: 60000 } }).body).not.toContain(',00');
	});

	it('always shows cents on documents', () => {
		const { body } = render(Money, { props: { value: 60000, context: 'document' } });
		expect(body).toContain(formatMoney(60000, { decimals: 'always' }));
	});

	it('never breaks between the sign and the figure', () => {
		const { body } = render(Money, { props: { value: 60000 } });
		expect(body).toContain('whitespace-nowrap');
		expect(body).toContain('tabular-nums');
	});

	it('reads a negative amount as «menos», for numbers and decimal strings', () => {
		for (const value of [-7000, '-7000.00']) {
			const body = flat(render(Money, { props: { value } }).body);
			expect(body).toContain('<span aria-hidden="true">−</span><span class="sr-only">menos</span>');
			expect(body).toContain(formatMoney(7000));
			expect(body).not.toContain('-$');
		}
		expect(render(Money, { props: { value: 0 } }).body).not.toContain('menos');
	});

	it('prints a dash for missing or invalid values', () => {
		expect(render(Money, { props: { value: null } }).body).toContain('—');
		expect(render(Money, { props: { value: 'abc' } }).body).toContain('—');
	});
});

describe('Badge marks', () => {
	it.each([
		['neutral', 'round'],
		['info', 'round'],
		['success', 'round'],
		['warning', 'diamond'],
		['danger', 'square']
	] as const)('the %s mark is %s, so state does not depend on colour', (tone, shape) => {
		const { body } = render(Badge, { props: { tone, children: text('Estado') } });
		expect(body).toContain(`data-shape="${shape}"`);
		expect(body).toContain('aria-hidden="true"');
	});

	it('draws the three shapes differently', () => {
		const mark = (tone: 'success' | 'warning' | 'danger') =>
			render(Badge, { props: { tone, children: text('x') } }).body;
		expect(mark('success')).toContain('rounded-full');
		expect(mark('warning')).toContain('rotate-45');
		expect(mark('warning')).not.toContain('rounded-full');
		expect(mark('danger')).toContain('rounded-[1px]');
	});
});

describe('MoneySheet', () => {
	const rows = [
		{ label: 'Efectivo recibido (13 pagos)', value: '380000.00' },
		{ label: 'Transferencias (8 pagos)', value: '230000.00' },
		{ label: 'Total cobrado', value: '610000.00', kind: 'subtotal' as const },
		{ label: 'Comisión que el cobrador se quedó', value: '44000.00', kind: 'deduction' as const },
		{ label: 'Neto para Bomberos', value: '566000.00', kind: 'lead' as const }
	];

	it('rules the subtotal, mutes the deduction and leads with the figure face', () => {
		const body = flat(render(MoneySheet, { props: { rows, context: 'document' } }).body);
		expect(body).toMatch(/data-kind="subtotal"[^>]*>|border-border-strong py-2\.5 font-semibold/);
		expect(body).toContain('border-double');
		expect(body).toMatch(
			/<dd class="[^"]*font-figure text-figure-lg[^"]*">.*?566\.000,00<\/span><\/dd>/
		);
		expect(body).toContain(formatMoney('380000.00', { decimals: 'always' }));
	});

	it('always shows a deduction as taken away, even when it is zero or already negative', () => {
		for (const value of ['44000.00', '-44000.00', 0]) {
			const body = flat(
				render(MoneySheet, { props: { rows: [{ label: 'Comisión', value, kind: 'deduction' }] } })
					.body
			);
			expect(body.match(/menos/g)).toHaveLength(1);
			expect(body).toContain('<span aria-hidden="true">−</span><span class="sr-only">menos</span>');
		}
	});

	it('uses whole pesos on screens', () => {
		const body = render(MoneySheet, { props: { rows } }).body;
		expect(body).toContain(formatMoney(566000));
		expect(body).not.toContain(',00');
	});

	it('keeps the definition list valid: each group holds one dt and one dd', () => {
		const body = flat(
			render(MoneySheet, { props: { rows, secondary: [{ label: 'a', value: 1 }] } }).body
		);
		const groups = body.match(/<div[^>]*>(.*?)<\/div>/g) ?? [];
		expect(groups).toHaveLength(6);
		for (const group of groups)
			expect(group).toMatch(/^<div[^>]*><dt[^>]*>.*<\/dt><dd[^>]*>.*<\/dd><\/div>$/);
	});

	it('renders the secondary amounts only when there are any', () => {
		expect(render(MoneySheet, { props: { rows } }).body.match(/<dl/g)).toHaveLength(1);
		const withSecondary = render(MoneySheet, {
			props: { rows, secondary: [{ label: 'Comisión generada', value: 71000 }] }
		}).body;
		expect(withSecondary.match(/<dl/g)).toHaveLength(2);
		expect(withSecondary).toContain('Comisión generada');
	});
});

describe('BondStub sizes', () => {
	it('keeps the large number by default and offers a medium one', () => {
		expect(render(BondStub, { props: { number: '0181', caption: 'Bono' } }).body).toContain(
			'text-[40px]'
		);
		const medium = render(BondStub, {
			props: { number: '0181', caption: 'Bono', size: 'md' }
		}).body;
		expect(medium).toContain('text-[32px]');
		expect(medium).not.toContain('text-[54px]');
	});
});

describe('barrel', () => {
	it('exports the figure components', () => {
		for (const name of ['BondNumber', 'Money', 'MoneySheet', 'BondStub'])
			expect(ui).toHaveProperty(name);
	});
});

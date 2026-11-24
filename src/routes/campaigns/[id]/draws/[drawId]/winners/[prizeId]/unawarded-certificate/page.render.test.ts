/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page@.svelte';
import source from './+page@.svelte?raw';

describe('unawarded prize certificate render', () => {
	it('renders all ten fields, escapes HTML and includes print styles', () => {
		const document = {
			institutionName: 'Firefighters <script>',
			draw: 'Final',
			prize: '#2 — Trip',
			winningNumber: '0008',
			associatedBond: 'B-8',
			buyer: 'Ada & Bob',
			reason: 'Winner <declined>',
			rosterStatus: 'Eligible',
			registeredBy: 'Resolver',
			date: '31/12/26, 23:30',
			notes: 'Original note'
		};
		const body = render(Page, { props: { data: { document }, params: {} } as any }).body;
		for (const value of Object.values(document).filter(
			(value) => !String(value).includes('<') && !String(value).includes('&')
		))
			expect(body).toContain(String(value));
		expect(body).toContain('Firefighters &lt;script>');
		expect(body).toContain('Ada &amp; Bob');
		expect(body).toContain('Winner &lt;declined>');
		expect(body).not.toContain('<script>');
		expect(source).toContain('@media print');
	});
});

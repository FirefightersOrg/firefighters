/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page@.svelte';
import source from './+page@.svelte?raw';

describe('delivery prize certificate render', () => {
	it('renders every field, escapes HTML and includes print styles', () => {
		const document = {
			institutionName: 'Firefighters <script>',
			draw: 'December (Monthly)',
			drawDate: '31/12/26',
			prize: '#1 — Bike',
			winningNumber: '0007',
			associatedBond: 'B-7',
			buyer: 'Buyer & Co',
			collector: 'Collector',
			rosterStatus: 'Eligible',
			deliveryDate: '31/12/26, 23:30',
			registeredBy: 'Operator',
			notes: 'Received <ok>',
			recipientSignature: 'Recipient signature',
			recipientName: 'Name / clarification',
			recipientDocument: 'DNI'
		};
		const body = render(Page, { props: { data: { document }, params: {} } as any }).body;
		for (const value of Object.values(document).filter(
			(value) => !String(value).includes('<') && !String(value).includes('&')
		))
			expect(body).toContain(String(value));
		expect(body).toContain('Firefighters &lt;script>');
		expect(body).toContain('Buyer &amp; Co');
		expect(body).toContain('Received &lt;ok>');
		expect(body).not.toContain('<script>');
		expect(source).toContain('@media print');
	});
});

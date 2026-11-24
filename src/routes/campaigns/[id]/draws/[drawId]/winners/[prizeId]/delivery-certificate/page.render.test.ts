/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page@.svelte';
import source from './+page@.svelte?raw';

const printCss = readFileSync('src/lib/styles/print.css', 'utf8');

describe('delivery prize certificate render', () => {
	it('renders every field, escapes HTML and includes print styles', () => {
		const document = {
			institutionName: 'Firefighters <script>',
			draw: 'December (Mensual)',
			drawDate: '31/12/2026',
			prize: '#1 — Bike',
			winningNumber: '0007',
			associatedBond: 'B-7',
			buyer: 'Buyer & Co',
			collector: 'Collector',
			rosterStatus: 'Habilitado',
			deliveryDate: '31/12/26, 23:30',
			registeredBy: 'Operator',
			notes: 'Received <ok>',
			recipientSignature: 'Firma de quien recibe',
			recipientName: 'Aclaración',
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
		expect(source).toContain("import '$lib/styles/print.css'");
		expect(printCss).toContain('@media print');
	});
});

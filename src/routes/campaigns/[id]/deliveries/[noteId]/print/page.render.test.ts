import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page@.svelte';

describe('printable delivery note page', () => {
	it('renders both copies with the fields and signature lines', () => {
		const document = {
			institutionName: 'Bomberos Test',
			campaign: 'Bono 2027',
			deliveryNoteNumber: 'Note 0007',
			date: '18/11/26, 12:30',
			collector: 'Ana Pérez',
			registeredBy: 'Operator One',
			deliveredBonds: [
				{
					type: 'Simple',
					numbers: [{ base: '0068', associated: '4939', barcode: null }],
					barcode: '0068',
					units: 1
				}
			],
			type: 'Simple',
			baseAndAssociatedNumbers: ['0068 / 4939'],
			barcode: ['0068'],
			notes: 'Box 3',
			collectorSignature: 'Collector signature',
			administrationSignature: 'Administration signature',
			bondCount: 1,
			unitCount: 1
		};
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal PageProps for SSR
		const body = render(Page, { props: { data: { document }, params: {} } as any }).body;
		expect(body).toContain('ORIGINAL – Administration');
		expect(body).toContain('DUPLICATE – Collector');
		for (const text of [
			'Bomberos Test',
			'Bono 2027',
			'Note 0007',
			'18/11/26, 12:30',
			'Ana Pérez',
			'Operator One',
			'0068 / 4939',
			'Box 3'
		]) {
			expect(body.split(text).length - 1).toBe(2);
		}
		expect(body.split('Collector signature').length - 1).toBe(2);
		expect(body.split('Administration signature').length - 1).toBe(2);
	});
});

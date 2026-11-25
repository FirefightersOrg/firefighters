import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page@.svelte';

describe('portal printable delivery note page', () => {
	it('renders the shared sheet: both copies, fields and signature lines', () => {
		const document = {
			institutionName: 'Bomberos Test',
			campaign: 'Bono 2027',
			deliveryNoteNumber: 'Remito 0007',
			reason: 'delivery' as const,
			status: 'issued' as const,
			date: '18/11/26, 12:30',
			collector: 'Ana Pérez',
			registeredBy: 'Administración',
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
			notes: null,
			collectorSignature: 'Firma del cobrador',
			administrationSignature: 'Firma de la administración',
			bondCount: 1,
			unitCount: 1
		};
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal PageProps for SSR
		const body = render(Page, { props: { data: { document }, params: {} } as any }).body;
		expect(body).toContain('ORIGINAL – Administración');
		expect(body).toContain('DUPLICADO – Cobrador');
		expect(body).toContain('Remito de entrega de bonos');
		for (const text of ['Remito 0007', 'Ana Pérez', '0068 / 4939', 'Firma del cobrador'])
			expect(body.split(text).length - 1).toBe(2);
		expect(body).toContain('Imprimir');
	});
});

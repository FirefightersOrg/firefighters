import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page@.svelte';

describe('printable delivery note page', () => {
	it('renders both copies with the fields and signature lines', () => {
		const document = {
			institutionName: 'Bomberos Test',
			campaign: 'Bono 2027',
			deliveryNoteNumber: 'Remito 0007',
			reason: 'delivery' as const,
			status: 'issued' as const,
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
			collectorSignature: 'Firma del cobrador',
			administrationSignature: 'Firma de la administración',
			bondCount: 1,
			unitCount: 1
		};
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal PageProps for SSR
		const body = render(Page, { props: { data: { document }, params: {} } as any }).body;
		expect(body).toContain('ORIGINAL – Administración');
		expect(body).toContain('DUPLICADO – Cobrador');
		for (const text of [
			'Bomberos Test',
			'Bono 2027',
			'Remito 0007',
			'18/11/26, 12:30',
			'Ana Pérez',
			'Operator One',
			'0068 / 4939',
			'Box 3'
		]) {
			expect(body.split(text).length - 1).toBe(2);
		}
		expect(body.match(/class="doc-bond-grid"/g)).toHaveLength(2);
		expect(body.match(/class="doc-bond">0068 \/ 4939/g)).toHaveLength(2);
		expect(body.split('Firma del cobrador').length - 1).toBe(2);
		expect(body.split('Firma de la administración').length - 1).toBe(2);
	});

	it('labels reassignment notes and marks annulled copies', () => {
		const document = {
			institutionName: 'Bomberos Test',
			campaign: 'Bono 2027',
			deliveryNoteNumber: 'Remito 0008',
			reason: 'reassignment' as const,
			status: 'annulled' as const,
			date: '18/11/26, 12:30',
			collector: 'Ana Pérez',
			registeredBy: 'Operator One',
			deliveredBonds: [],
			type: '',
			baseAndAssociatedNumbers: [],
			barcode: [],
			notes: null,
			collectorSignature: 'Firma del cobrador',
			administrationSignature: 'Firma de la administración',
			bondCount: 0,
			unitCount: 0
		};
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal PageProps for SSR
		const body = render(Page, { props: { data: { document }, params: {} } as any }).body;
		expect(body.split('Reasignación de bonos').length - 1).toBe(2);
		expect(body.split('ANULADO').length - 1).toBe(2);
	});

	it('labels return notes and has the collector attest to handing bonds back', () => {
		const document = {
			institutionName: 'Bomberos Test',
			campaign: 'Bono 2027',
			deliveryNoteNumber: 'Remito 0009',
			reason: 'return' as const,
			status: 'issued' as const,
			date: '18/11/26, 12:30',
			collector: 'Ana Pérez',
			registeredBy: 'Operator One',
			deliveredBonds: [],
			type: '',
			baseAndAssociatedNumbers: [],
			barcode: [],
			notes: null,
			collectorSignature: 'Firma del cobrador',
			administrationSignature: 'Firma de la administración',
			bondCount: 0,
			unitCount: 0
		};
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal PageProps for SSR
		const body = render(Page, { props: { data: { document }, params: {} } as any }).body;

		expect(body.split('Remito de devolución de bonos').length - 1).toBe(2);
		expect(body.split('DEVOLVIÓ los bonos').length - 1).toBe(2);
		expect(body).not.toContain('Remito de entrega de bonos');
	});
});

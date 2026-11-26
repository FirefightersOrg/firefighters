import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import type { Campaign } from '$lib/domain/campaigns';
import Page from './+page.svelte';

const CAMPAIGN_ID = 'f0000000-0000-0000-0000-000000000001';

const campaign: Campaign = {
	id: CAMPAIGN_ID,
	name: 'Campaign 2027',
	status: 'draft',
	startsAt: null,
	endsAt: null,
	simpleBondValue: '60000.00',
	installmentCount: 10,
	installmentValue: '6000.00',
	numberDigits: 4,
	maxNumber: 9999,
	associatedNumberOffset: 4871,
	associatedNumberMode: 'linear',
	overflowPolicy: 'reject',
	barcodeMode: 'base_number',
	barcodePattern: null,
	createdBy: null,
	createdAt: '2026-11-17T10:00:00+00:00',
	updatedAt: '2026-11-17T10:00:00+00:00'
};

function renderPage(sessions: unknown[] = []) {
	const data = { campaign, canLoad: true, lockedMessage: null, sessions };
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal PageProps for SSR
	const props = { data, form: null, params: { id: CAMPAIGN_ID } } as any;
	return render(Page, { props }).body;
}

describe('/campaigns/[id]/bonds/import page', () => {
	it('explains the file in words and keeps the column names under a disclosure', () => {
		const body = renderPage();
		expect(body).toContain('Cómo tiene que ser el archivo');
		expect(body).toContain('tipo_bono,grupo_pata,numero_base,barcode');
		expect(body).toContain('No se crea ningún bono hasta confirmar.');
		expect(body).toContain('ya no se pueden cambiar sus reglas');
		expect(body).not.toContain('→');
	});

	it('has an empty state that says what to do', () => {
		expect(renderPage()).toContain('Todavía no se importó ningún archivo');
	});

	it('lists the imports as stacked rows with the file as the way in', () => {
		const body = renderPage([
			{
				id: 'a0000000-0000-0000-0000-000000000001',
				fileName: 'marzo.csv',
				notes: null,
				sourceType: 'csv_file',
				status: 'draft',
				rolledBackAt: null,
				createdAt: '2026-11-18T12:00:00+00:00'
			}
		]);
		expect(body).toContain('data-stack="true"');
		expect(body).toContain(
			`href="/campaigns/${CAMPAIGN_ID}/bonds/import/a0000000-0000-0000-0000-000000000001"`
		);
		expect(body).toContain('Archivo CSV, subido el');
	});
});

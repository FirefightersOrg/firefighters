import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import type { Campaign } from '$lib/domain/campaigns';
import type { ImportItem, ImportSession } from '$lib/server/repositories/imports';
import Page from './+page.svelte';

const CAMPAIGN_ID = 'f0000000-0000-0000-0000-000000000001';
const SESSION_ID = 'a0000000-0000-0000-0000-000000000001';

const campaign: Campaign = {
	id: CAMPAIGN_ID,
	name: 'Campaign 2027',
	status: 'active',
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

const session = {
	id: SESSION_ID,
	campaignId: CAMPAIGN_ID,
	sourceType: 'barcode_scan',
	status: 'draft'
} as ImportSession;

function scanned(overrides: Partial<ImportItem> = {}): ImportItem {
	return {
		id: 'c0000000-0000-0000-0000-000000000001',
		sessionId: SESSION_ID,
		rowNumber: 3,
		rawValue: '68',
		fields: {},
		barcode: '68',
		baseNumber: 68,
		groupKey: null,
		itemType: 'simple',
		status: 'valid',
		errorMessage: null,
		removedAt: null,
		removeReason: null,
		createdBondId: null,
		...overrides
	} as ImportItem;
}

function renderPage(
	options: { session?: ImportSession | null; recent?: ImportItem[]; form?: unknown } = {}
) {
	const data = {
		campaign,
		canLoad: true,
		lockedMessage: null,
		needsBaseNumber: false,
		openSessions: [],
		session: options.session === undefined ? session : options.session,
		summary: null,
		recent: options.recent ?? []
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal PageProps for SSR
	const props = { data, form: options.form ?? null, params: { id: CAMPAIGN_ID } } as any;
	return render(Page, { props }).body;
}

describe('/campaigns/[id]/bonds/scan page', () => {
	it('opens with a sentence, not with system words', () => {
		const body = renderPage();
		expect(body).toContain('Cada código se revisa al instante.');
		expect(body).toContain('Código de la pata (solo patas)');
		expect(body).not.toContain('grupo_pata');
		expect(body).not.toContain('→');
	});

	it('says what each read did, number first', () => {
		const ok = renderPage({
			form: { form: 'scan', success: true, message: 'ok', scanned: scanned(), errors: {} }
		});
		expect(ok).toContain('Leído:');
		expect(ok).toContain('>0068<');
		expect(ok).toContain('/ 4939');
		const failed = renderPage({
			form: { form: 'scan', success: false, message: 'Código no válido.', errors: {} }
		});
		expect(failed).toContain('Código no válido. Volver a escanear.');
	});

	it('shows the recent reads as stacked rows with the number first', () => {
		const body = renderPage({ recent: [scanned()] });
		expect(body).toContain('data-stack="true"');
		expect(body).toContain('Fila 3, código 68.');
		expect(body).toContain('0068');
	});

	it('invites to scan when nothing was read yet', () => {
		expect(renderPage()).toContain('Todavía no se escaneó nada');
	});
});

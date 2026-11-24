import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import type { Campaign } from '$lib/domain/campaigns';
import type { ImportItem, ImportSession } from '$lib/server/repositories/imports';
import type { ImportSessionSummary } from '$lib/server/services/imports';
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
	overflowPolicy: 'reject',
	barcodeMode: 'base_number',
	barcodePattern: null,
	createdBy: null,
	createdAt: '2026-11-17T10:00:00+00:00',
	updatedAt: '2026-11-17T10:00:00+00:00'
};

const session: ImportSession = {
	id: SESSION_ID,
	campaignId: CAMPAIGN_ID,
	sourceType: 'csv_file',
	status: 'draft',
	fileName: 'march.csv',
	notes: null,
	createdBy: 'e0000000-0000-0000-0000-000000000001',
	createdAt: '2026-11-18T12:00:00+00:00',
	updatedAt: '2026-11-18T12:00:00+00:00',
	validatedAt: null,
	confirmedAt: null,
	cancelledAt: null,
	cancelReason: null,
	failedAt: null,
	failureReason: null,
	rolledBackAt: null,
	rollbackReason: null
};

const summary: ImportSessionSummary = {
	sessionId: SESSION_ID,
	campaignId: CAMPAIGN_ID,
	sourceType: 'csv_file',
	fileName: 'march.csv',
	items: 2,
	status: 'draft',
	liveItems: 2,
	removedItems: 0,
	simpleItems: 2,
	pataGroups: 0,
	pataRows: 0,
	baseNumbers: 2,
	participatingNumbers: 4,
	pending: 0,
	errors: 1,
	warnings: 0,
	duplicates: 0,
	valid: false
};

function item(overrides: Partial<ImportItem> = {}): ImportItem {
	return {
		id: 'c0000000-0000-0000-0000-000000000001',
		sessionId: SESSION_ID,
		rowNumber: 2,
		rawValue: 'simple,,0068,B-68',
		fields: { tipoBono: 'simple', grupoPata: null, numeroBase: '0068', barcode: 'B-68' },
		barcode: 'B-68',
		itemType: 'simple',
		groupKey: null,
		baseNumber: 68,
		status: 'valid',
		errorCode: null,
		errorMessage: null,
		createdBondId: null,
		removedAt: null,
		removedBy: null,
		removeReason: null,
		...overrides
	};
}

function renderPage(
	options: { summary?: Partial<ImportSessionSummary>; items?: ImportItem[]; canEdit?: boolean } = {}
) {
	const data = {
		campaign,
		session,
		summary: { ...summary, ...options.summary },
		items: options.items ?? [item()],
		total: (options.items ?? [item()]).length,
		filter: 'all',
		page: 1,
		pageSize: 200,
		justConfirmed: false,
		canEdit: options.canEdit ?? true,
		lockedMessage: null,
		canRollBack: false
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal PageProps for SSR
	const props = { data, form: null, params: { id: CAMPAIGN_ID, sessionId: SESSION_ID } } as any;
	return render(Page, { props }).body;
}

/** Opening tag of the submit button whose label contains `label`. */
const submitTag = (body: string, label: string) =>
	[...body.matchAll(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<\/button>/g)]
		.map((m) => m[0])
		.find((button) => button.includes('type="submit"') && button.includes(label))
		?.match(/^<button[^>]*>/)?.[0] ?? '';
/** The `disabled` attribute itself, not the `disabled:` Tailwind variants in `class`. */
const isDisabled = (tag: string) => /\sdisabled=""/.test(tag);

describe('/campaigns/[id]/bonds/import/[sessionId] page', () => {
	it('shows the seven summary metrics', () => {
		const body = renderPage();
		for (const label of [
			'Bonos simples',
			'Patas',
			'Números base',
			'Números participantes',
			'Errores bloqueantes',
			'Observaciones',
			'Duplicados'
		]) {
			expect(body).toContain(label);
		}
	});

	it('renders a staged number outside the campaign range instead of failing', () => {
		const body = renderPage({
			items: [
				item({
					baseNumber: 5500,
					status: 'error',
					errorCode: 'number_out_of_range',
					errorMessage: 'El número 5500 no entra en la campaña (máximo 9999).'
				})
			]
		});
		expect(body).toContain('5500 / 10371');
		expect(body).toContain('El número 5500 no entra en la campaña (máximo 9999).');
	});

	it('disables Confirm while there are blocking errors and explains why', () => {
		const body = renderPage();
		expect(isDisabled(submitTag(body, 'Confirmar y crear 2 bonos'))).toBe(true);
		expect(body).toContain('Confirmar está deshabilitado: corregir o quitar la fila con error.');
	});

	it('enables Confirm on a clean validated session', () => {
		const body = renderPage({ summary: { status: 'validated', errors: 0, valid: true } });
		expect(isDisabled(submitTag(body, 'Confirmar y crear'))).toBe(false);
		expect(body).toContain('Confirmar y crear 2 bonos');
	});

	it('offers no edit, remove or confirm once the session is closed', () => {
		const body = renderPage({ canEdit: false });
		expect(body).not.toContain('Confirmar y crear');
		expect(body).not.toContain('Quitar la fila');
		expect(body).not.toContain('Editar la fila');
	});
});

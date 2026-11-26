import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createActiveCampaign, login, open, runId } from './helpers';

/**
 * UX follow-up to A10: the screens that load bonds (manual entry, pata, scan, file import and its
 * preview) read like the rest of the redesign. A campaign with a staged import and a scan batch is
 * built through the screens themselves, then each is opened at 375 px: no sideways scroll, the
 * number first, stacked rows, and no serious axe violations.
 */
const baseURL = `http://127.0.0.1:${process.env.E2E_PORT ?? 4317}`;
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const TOLERANCE = 1;

let admin: BrowserContext;
let campaignId: string;
let previewPath: string;

async function noSidewaysScroll(page: Page, label: string) {
	const overflow = await page.evaluate(
		() => document.scrollingElement!.scrollWidth - window.innerWidth
	);
	expect(overflow, `${label} scrolls sideways at 375 px`).toBeLessThanOrEqual(TOLERANCE);
}

async function noSeriousViolations(page: Page, label: string) {
	const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
	const serious = results.violations.filter(
		(v) => v.impact === 'serious' || v.impact === 'critical'
	);
	expect(
		serious.map((v) => `${v.id}: ${v.help}`),
		`${label}: axe serious/critical violations`
	).toEqual([]);
}

test.describe.serial('bond loading screens', () => {
	test.beforeAll(async ({ browser }) => {
		test.setTimeout(180_000);
		admin = await browser.newContext({
			baseURL,
			locale: 'es-AR',
			serviceWorkers: 'block',
			viewport: { width: 375, height: 812 },
			hasTouch: true
		});
		const page = await admin.newPage();
		await login(page);
		campaignId = await createActiveCampaign(page, `E2E carga ${runId()}`);
		await page.close();
	});

	test.afterAll(async () => {
		await admin?.close();
	});

	test('manual entry: the numbering is explained in sentences and the preview shows both numbers', async () => {
		const page = await admin.newPage();
		await open(page, `/campaigns/${campaignId}/bonds/new`);
		await expect(page.getByText('Se pueden usar los números base de')).toBeVisible();
		await page.locator('#baseNumber').fill('68');
		await expect(page.locator('#baseNumber-preview')).toContainText('0068');
		await expect(page.locator('#baseNumber-preview')).toContainText('5068');
		await expect(page.locator('body')).not.toContainText('→');
		await page.locator('button[type="submit"][value="another"]').click();
		await expect(page.getByText('Cargados en esta visita')).toBeVisible();
		await noSidewaysScroll(page, 'bonds/new');
		await noSeriousViolations(page, 'bonds/new');
		await page.close();
	});

	test('pata: the preview lists the pairs with the number first', async () => {
		const page = await admin.newPage();
		await open(page, `/campaigns/${campaignId}/bonds/pata/new`);
		await page.locator('#baseNumbers').fill('100, 101');
		await expect(page.locator('#pata-preview')).toContainText('0100');
		await expect(page.locator('#pata-preview')).toContainText('2 bonos de');
		await expect(page.locator('body')).not.toContainText('→');
		await noSidewaysScroll(page, 'bonds/pata/new');
		await noSeriousViolations(page, 'bonds/pata/new');
		await page.close();
	});

	test('import: the upload leads to a preview that opens with what would be created', async () => {
		const page = await admin.newPage();
		await open(page, `/campaigns/${campaignId}/bonds/import`);
		await noSidewaysScroll(page, 'bonds/import (empty)');
		await page.locator('#file').setInputFiles({
			name: 'carga.csv',
			mimeType: 'text/csv',
			buffer: Buffer.from(
				'tipo_bono,grupo_pata,numero_base,barcode\nsimple,,200,200\nsimple,,201,201\nsimple,,99999,99999\n'
			)
		});
		await page.getByRole('button', { name: 'Subir y revisar' }).click();
		await expect(page).toHaveURL(/\/bonds\/import\/[0-9a-f-]{36}$/);
		previewPath = new URL(page.url()).pathname;
		await expect(page.getByText(/Hay 3 bonos \(3 simples\)/)).toBeVisible();
		await expect(page.getByText(/1 fila tiene un error que impide confirmar/)).toBeVisible();
		await noSidewaysScroll(page, 'bonds/import/[sessionId]');
		await noSeriousViolations(page, 'bonds/import/[sessionId]');

		await open(page, `/campaigns/${campaignId}/bonds/import`);
		await expect(page.locator('table[data-stack="true"]')).toBeVisible();
		await noSidewaysScroll(page, 'bonds/import (with history)');
		await noSeriousViolations(page, 'bonds/import (with history)');
		await page.close();
	});

	test('scan: each read says what happened, number first', async () => {
		const page = await admin.newPage();
		await open(page, `/campaigns/${campaignId}/bonds/scan`);
		await noSidewaysScroll(page, 'bonds/scan (start)');
		await page.getByRole('button', { name: 'Iniciar escaneo' }).click();
		await expect(page).toHaveURL(/\/bonds\/scan\?session=/);
		await page.locator('#barcode').fill('300');
		await page.locator('#barcode').press('Enter');
		await expect(page.getByText('Leído:')).toBeVisible();
		await expect(page.locator('#recent')).toContainText('0300');
		await noSidewaysScroll(page, 'bonds/scan (session)');
		await noSeriousViolations(page, 'bonds/scan (session)');
		await page.close();
	});

	test('the staged import preview is still reachable after the others', async () => {
		const page = await admin.newPage();
		await open(page, previewPath);
		await expect(page.getByRole('heading', { level: 1, name: 'carga.csv' })).toBeVisible();
		await page.close();
	});
});

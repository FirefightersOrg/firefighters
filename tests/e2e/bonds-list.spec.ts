import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext } from '@playwright/test';
import {
	createActiveCampaign,
	createBond,
	createCollector,
	deliverAndSell,
	login,
	open,
	runId
} from './helpers';

/**
 * UX plan, PR 9 (audit A7, A10, A15). The bonds list: the number first and the other filters
 * folded, rows that say who has the bond, stacked rows on a phone, and a search by number that
 * opens the record when exactly one bond matches.
 */
const baseURL = `http://127.0.0.1:${process.env.E2E_PORT ?? 4317}`;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const SOLD = 520;
const AVAILABLE = 521;

let admin: BrowserContext;
let campaignId: string;
let collector: string;

test.describe.serial('bonds list and bond search', () => {
	test.beforeAll(async ({ browser }) => {
		test.setTimeout(180_000);
		const run = runId();
		collector = `Cobrador ${run}`;
		admin = await browser.newContext({ baseURL, locale: 'es-AR' });
		const page = await admin.newPage();
		await login(page);
		campaignId = await createActiveCampaign(page, `E2E bonos ${run}`);
		await createCollector(page, campaignId, collector);
		await createBond(page, campaignId, AVAILABLE);
		await createBond(page, campaignId, SOLD);
		await deliverAndSell(page, campaignId, collector, SOLD);
		await page.close();
	});

	test.afterAll(async () => {
		await admin?.close();
	});

	test('a number typed in the top bar of any campaign screen opens the bond’s record', async () => {
		const page = await admin.newPage();
		await open(page, `/campaigns/${campaignId}/collectors`);
		const search = page.getByRole('search', { name: 'Buscar bono' });
		await search.getByRole('textbox').fill(String(SOLD));
		await search.getByRole('textbox').press('Enter');
		// Two screens: where the person was, and the record.
		await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}/bonds/${UUID}$`));
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		await page.close();
	});

	test('no match, or a search with another filter, keeps the list', async () => {
		const page = await admin.newPage();
		await open(page, `/campaigns/${campaignId}/bonds?base=9999`);
		await expect(page).toHaveURL(/\/bonds\?base=9999$/);
		await expect(page.getByText('Ningún bono coincide con los filtros')).toBeVisible();
		await open(page, `/campaigns/${campaignId}/bonds?base=${SOLD}&status=sold`);
		await expect(page).toHaveURL(new RegExp(`/bonds\\?base=${SOLD}&status=sold$`));
		await expect(page.locator('[data-bond-id]')).toHaveCount(1);
		await page.close();
	});

	test('each row says who has the bond; the number is the way into the record', async () => {
		const page = await admin.newPage();
		await open(page, `/campaigns/${campaignId}/bonds`);
		const rows = page.locator('tbody tr');
		await expect(rows).toHaveCount(2);
		const sold = rows.filter({ hasText: String(SOLD) });
		await expect(sold).toContainText(`Vendido a Ana Comprador ${collector}, lo cobra ${collector}`);
		await expect(rows.filter({ hasText: String(AVAILABLE) })).toContainText('Disponible');
		// Nothing left of filters and actions that never worked.
		await expect(page.locator('main')).not.toContainText(/fase/i);
		await expect(page.getByRole('button', { name: 'Asignar a cobrador' })).toHaveCount(0);
		await sold.getByRole('link', { name: new RegExp(String(SOLD)) }).click();
		await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}/bonds/${UUID}$`));
		await page.close();
	});

	test('the other filters are folded; what is applied shows as chips that can be removed', async () => {
		const page = await admin.newPage();
		await open(page, `/campaigns/${campaignId}/bonds`);
		const status = page.locator('#filter-status');
		await expect(status).toBeHidden();
		await page.locator('[data-filter-bar] summary').click();
		await status.selectOption('sold');
		await page.getByRole('button', { name: 'Aplicar filtros' }).click();
		await expect(page).toHaveURL(/[?&]status=sold/);
		await expect(page.locator('[data-bond-id]')).toHaveCount(1);
		const chip = page.getByRole('link', { name: 'Quitar el filtro Estado: Vendido' });
		await expect(chip).toBeVisible();
		await chip.click();
		await expect(page).not.toHaveURL(/status=/);
		await expect(page.locator('[data-bond-id]')).toHaveCount(2);
		await page.close();
	});

	for (const scheme of ['light', 'dark'] as const)
		test(`phone: stacked rows, the first one in the first screen, no sideways scroll, axe (${scheme})`, async ({
			browser
		}) => {
			const phone = await browser.newContext({
				baseURL,
				viewport: { width: 375, height: 800 },
				isMobile: true,
				hasTouch: true,
				colorScheme: scheme,
				storageState: await admin.storageState(),
				locale: 'es-AR'
			});
			const page = await phone.newPage();
			await open(page, `/campaigns/${campaignId}/bonds`);
			const first = await page.locator('[data-bond-id]').first().boundingBox();
			expect(first, 'the first row is on the page').not.toBeNull();
			expect(first!.y + first!.height, 'the first row is in the first screen').toBeLessThan(800);
			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth
			);
			expect(overflow, 'the page does not scroll sideways').toBeLessThanOrEqual(0);
			// Who has it is on the row, under the number, without scrolling the table.
			const who = page.getByText(`Vendido a Ana Comprador ${collector}, lo cobra ${collector}`);
			await expect(who).toBeVisible();
			const box = await who.boundingBox();
			expect(box!.x + box!.width, 'the second line fits the screen').toBeLessThanOrEqual(375);
			const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
			expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
			await phone.close();
		});
});

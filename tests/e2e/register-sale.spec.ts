import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
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
 * UX plan, PR 12 (audit A6). Registering a sale: what was answered stays while the rest is filled
 * in (searching for the buyer no longer loses the bond), each answered step is one line, the button
 * says what it registers, and a bond's record leads here with the bond already found.
 */
const baseURL = `http://127.0.0.1:${process.env.E2E_PORT ?? 4317}`;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const SOLD = 610;
const FIRST = 611;
const SECOND = 612;

let admin: BrowserContext;
let campaignId: string;
let collector: string;
let buyer: string;

/** Delivers `base` to the collector, through the delivery screen. */
async function deliver(page: Page, base: number) {
	await open(page, `/campaigns/${campaignId}/deliveries/new`);
	await page.locator('#query').fill(String(base));
	await page.getByRole('button', { name: 'Agregar' }).click();
	await expect(page.getByText('1 bono agregado.')).toBeVisible();
	await page.locator('#collectorId').selectOption({ label: collector });
	await page.getByRole('button', { name: `Entregar 1 bono a ${collector}` }).click();
	await expect(page).toHaveURL(/\/deliveries\/[0-9a-f-]{36}$/);
}

const findBond = async (page: Page, base: number) => {
	await page.locator('#query').fill(String(base));
	await page.locator('form[action="?/lookup"] button[type="submit"]').click();
};

test.describe.serial('register a sale', () => {
	test.beforeAll(async ({ browser }) => {
		test.setTimeout(240_000);
		const run = runId();
		collector = `Cobrador ${run}`;
		// The buyer `deliverAndSell` creates inline; the list shows it as «Apellido, Nombre».
		buyer = `Comprador ${collector}, Ana`;
		admin = await browser.newContext({ baseURL, locale: 'es-AR' });
		const page = await admin.newPage();
		await login(page);
		campaignId = await createActiveCampaign(page, `E2E venta ${run}`);
		await createCollector(page, campaignId, collector);
		for (const base of [SOLD, FIRST, SECOND]) await createBond(page, campaignId, base);
		await deliverAndSell(page, campaignId, collector, SOLD);
		await deliver(page, FIRST);
		await deliver(page, SECOND);
		await page.close();
	});

	test.afterAll(async () => {
		await admin?.close();
	});

	test('searching for the buyer after the bond keeps the bond; the button names both', async () => {
		const page = await admin.newPage();
		await open(page, `/campaigns/${campaignId}/sales/new`);
		await findBond(page, FIRST);
		const chosenBond = page.locator('[data-chosen-bond]');
		await expect(chosenBond).toContainText(`0${FIRST}`);
		await expect(chosenBond).toContainText(`Lo tiene ${collector}`);

		// The search that used to reload the page and drop the bond.
		await page.locator('#buyer-search').fill(`Comprador ${collector}`);
		await page.locator('[data-step="buyer"] form[role="search"] button[type="submit"]').click();
		await expect(page).toHaveURL(/[?&]buyer=/);
		await expect(chosenBond).toContainText(`0${FIRST}`);
		// One buyer matches: it is chosen, and the step is one line.
		await expect(page.locator('[data-chosen-buyer]')).toContainText(buyer);
		await expect(
			page.getByRole('button', { name: `Confirmar venta del bono 0${FIRST} a ${buyer}` })
		).toBeVisible();

		// «Cambiar» opens the step again without touching the other one.
		await page.getByRole('button', { name: 'Cambiar el comprador' }).click();
		await expect(page.getByRole('radio', { name: new RegExp(buyer) })).toBeVisible();
		await expect(chosenBond).toBeVisible();
		await page.getByRole('radio', { name: new RegExp(buyer) }).click();
		await expect(page.locator('[data-chosen-buyer]')).toBeVisible();

		// In installments the plan is shown before confirming.
		await page.locator('[data-step="payment"]').getByText('En cuotas', { exact: true }).click();
		await expect(page.getByRole('list', { name: 'Plan de cuotas previsto' })).toBeVisible();
		await page.locator('[data-step="payment"]').getByText('Pago total', { exact: true }).click();
		await page.locator('[data-confirm-sale]').click();
		await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}/sales/${UUID}$`));
		await page.close();
	});

	test('a bond that cannot be sold says why, and nothing can be confirmed for it', async () => {
		const page = await admin.newPage();
		await open(page, `/campaigns/${campaignId}/sales/new`);
		await findBond(page, SOLD);
		await expect(page.locator('[data-step="bond"]')).toContainText(
			`El bono 0${SOLD} no se puede vender: Ya está vendido.`
		);
		await expect(page.locator('[data-chosen-bond]')).toHaveCount(0);
		await page.locator('[data-confirm-sale]').click();
		await expect(page.locator('#bondId-error')).toBeVisible();
		await expect(page).toHaveURL(/\/sales\/new/);
		await page.close();
	});

	test('the bond’s record leads here with the bond already found', async () => {
		const page = await admin.newPage();
		await open(page, `/campaigns/${campaignId}/bonds?base=${SECOND}`);
		await expect(page).toHaveURL(new RegExp(`/bonds/${UUID}$`));
		await page.getByRole('link', { name: 'Registrar venta' }).click();
		await expect(page).toHaveURL(new RegExp(`/sales/new\\?bond=0${SECOND}$`));
		await expect(page.locator('[data-chosen-bond]')).toContainText(`0${SECOND}`);
		await page.close();
	});

	for (const scheme of ['light', 'dark'] as const)
		test(`phone: nothing is cut, the whole button is on screen, axe (${scheme})`, async ({
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
			// This run's buyer by its whole name: other specs leave their own buyers in the database.
			await open(
				page,
				`/campaigns/${campaignId}/sales/new?bond=${SECOND}&buyer=${encodeURIComponent(`Comprador ${collector}`)}`
			);
			await expect(page.locator('[data-chosen-bond]')).toBeVisible();
			await expect(page.locator('[data-chosen-buyer]')).toBeVisible();
			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth
			);
			expect(overflow, 'the page does not scroll sideways').toBeLessThanOrEqual(0);
			// A long label wraps instead of running off the button.
			const button = page.locator('[data-confirm-sale]');
			const clipped = await button.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
			expect(clipped, 'the confirm label fits its button').toBe(false);
			const box = await button.boundingBox();
			expect(box!.x).toBeGreaterThanOrEqual(0);
			expect(box!.x + box!.width).toBeLessThanOrEqual(375);
			expect(box!.height).toBeGreaterThanOrEqual(44);
			const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
			expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
			await phone.close();
		});
});

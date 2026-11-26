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
 * UX plan, PR 8 (audit A3, A10). The bond record opens with what the bond is, who has it, who
 * bought it and what is owed, and offers the one next step of its state; the history, the reference
 * data and the corrections are collapsed underneath, with the same actions as before.
 */
const baseURL = `http://127.0.0.1:${process.env.E2E_PORT ?? 4317}`;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const SOLD = 410;
const AVAILABLE = 411;

let admin: BrowserContext;
let campaignId: string;
let collector: string;
let soldPath: string;
let availablePath: string;

const sentence = (page: Page) => page.locator('[data-bond-sentence]');

test.describe.serial('bond record', () => {
	test.beforeAll(async ({ browser }) => {
		test.setTimeout(180_000);
		const run = runId();
		collector = `Cobrador ${run}`;
		admin = await browser.newContext({ baseURL, locale: 'es-AR' });
		const page = await admin.newPage();
		await login(page);
		campaignId = await createActiveCampaign(page, `E2E ficha ${run}`);
		await createCollector(page, campaignId, collector);
		await createBond(page, campaignId, AVAILABLE);
		availablePath = new URL(page.url()).pathname;
		await createBond(page, campaignId, SOLD);
		soldPath = new URL(page.url()).pathname;
		await deliverAndSell(page, campaignId, collector, SOLD);
		await page.close();
	});

	test.afterAll(async () => {
		await admin?.close();
	});

	test('an available bond says so and offers to deliver it', async () => {
		const page = await admin.newPage();
		await open(page, availablePath);
		await expect(sentence(page)).toHaveText('Disponible. Todavía no se entregó a ningún cobrador.');
		await expect(page.locator('[data-bond-summary]')).toContainText(String(AVAILABLE));
		const next = page.getByRole('link', { name: 'Entregar a un cobrador' });
		await expect(next).toBeVisible();
		await expect(page.getByRole('link', { name: 'Registrar venta' })).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Registrar pago' })).toHaveCount(0);
		// Nothing left of how the system was built.
		await expect(page.locator('main')).not.toContainText(/fase/i);
		await next.click();
		await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}/deliveries/new$`));
		await page.close();
	});

	test('a sold bond names the buyer and the collector, says what is owed and leads to the payment', async () => {
		const page = await admin.newPage();
		await open(page, soldPath);
		await expect(sentence(page)).toContainText(`Vendido a Ana Comprador ${collector} en un pago.`);
		await expect(sentence(page)).toContainText(`Lo cobra ${collector}.`);
		await expect(sentence(page)).toContainText(
			/Debe \$\s1\.000, que vence el \d{2}\/\d{2}\/\d{4}\./
		);
		// The names lead to their records.
		await expect(
			sentence(page).getByRole('link', { name: collector, exact: true })
		).toHaveAttribute('href', new RegExp(`/campaigns/${campaignId}/collectors/${UUID}$`));
		await expect(
			sentence(page).getByRole('link', { name: `Ana Comprador ${collector}` })
		).toHaveAttribute('href', new RegExp(`/campaigns/${campaignId}/buyers/${UUID}$`));
		// Installments: what is owed, with the total.
		const installments = page.locator('#installments');
		await expect(installments.locator('[data-installment]')).toHaveCount(1);
		await expect(installments).toContainText('Falta cobrar');
		await expect(installments.getByRole('link', { name: 'Ver la venta' })).toBeVisible();

		// The one next step: the payment, with the collector already chosen.
		await page.getByRole('link', { name: 'Registrar pago' }).click();
		await expect(page).toHaveURL(/\/settlements\/new\?intent=payment&collector=/);
		await expect(page.locator('#collectorId')).toHaveValue(new RegExp(`^${UUID}$`));
		await expect(page.locator('#collectorId option:checked')).toHaveText(collector);
		await page.close();
	});

	test('a payment in an open settlement is shown as waiting; once it closes the bond is paid', async () => {
		const page = await admin.newPage();
		await open(page, `/campaigns/${campaignId}/settlements/new?intent=payment`);
		await page.locator('#collectorId').selectOption({ label: collector });
		await page.getByRole('button', { name: 'Abrir rendición y cargar pagos' }).click();
		await expect(page).toHaveURL(new RegExp(`/settlements/${UUID}$`));
		const settlement = new URL(page.url()).pathname;
		const number = page.getByLabel('Número del bono que pagó');
		await page.waitForLoadState('networkidle');
		await number.fill(String(SOLD));
		await number.press('Enter');
		await expect(page.locator('[data-found-sale]')).toBeVisible();
		await number.press('Enter');
		await expect(page.getByText('Pago agregado.')).toBeVisible();

		// Not handed over yet: the bond still owes it, and the record says where the money is.
		await open(page, soldPath);
		await expect(sentence(page)).toContainText(/Debe \$\s1\.000/);
		await expect(page.locator('[data-waiting-payment]')).toContainText(
			/Pago de \$\s1\.000 en efectivo cargado en la rendición \d+, que sigue abierta/
		);
		await expect(page.getByRole('link', { name: 'Registrar pago' })).toBeVisible();

		await open(page, settlement);
		await page.getByRole('button', { name: 'Cerrar rendición' }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'Cerrar rendición' }).click();
		await expect(page.getByText('Rendición cerrada.')).toBeVisible();

		await open(page, soldPath);
		await expect(sentence(page)).toContainText(`Lo cobró ${collector}. Está pagado.`);
		await expect(page.locator('[data-waiting-payment]')).toHaveCount(0);
		await expect(page.locator('#installments')).toContainText(
			/Pagada el .* en efectivo, rendición \d+/
		);
		await expect(page.getByRole('link', { name: 'Registrar pago' })).toHaveCount(0);
		// The certificate of the payment is one group away.
		await page.locator('summary', { hasText: 'Pagos y comprobantes' }).click();
		await expect(page.getByRole('link', { name: 'Comprobante' })).toBeVisible();
		await page.close();
	});

	test('the corrections are collapsed, reachable by keyboard, and open by themselves on an error', async () => {
		const page = await admin.newPage();
		await open(page, availablePath);
		const annul = page.getByRole('button', { name: 'Anular bono' });
		await expect(annul).toBeHidden();
		const group = page.locator('summary', { hasText: 'Corregir o anular' });
		await group.focus();
		await page.keyboard.press('Enter');
		await expect(annul).toBeVisible();
		await expect(group).toHaveAttribute('aria-expanded', 'true');
		// The other groups are there too, with the same actions as before.
		await page.locator('summary', { hasText: 'Entregas y devoluciones' }).click();
		await expect(page.getByRole('button', { name: 'Marcar como extraviado' })).toBeVisible();
		await page.locator('summary', { hasText: 'Datos del bono' }).click();
		await expect(page.locator('#general')).toContainText('Valor total');
		await page.close();
	});

	for (const scheme of ['light', 'dark'] as const)
		test(`phone: who bought it and who collects it are on the first screen; axe (${scheme})`, async ({
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
			await open(page, soldPath);
			const box = await sentence(page).boundingBox();
			expect(box, 'the sentence is on the page').not.toBeNull();
			expect(box!.y + box!.height, 'the sentence fits in the first screen').toBeLessThanOrEqual(
				800
			);
			await expect(sentence(page)).toContainText(collector);
			const metrics = await page.evaluate(() => ({
				overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
				screens: document.documentElement.scrollHeight / window.innerHeight
			}));
			expect(metrics.overflow, 'the page does not scroll sideways').toBeLessThanOrEqual(0);
			expect(metrics.screens, 'the record of a sold bond is short').toBeLessThanOrEqual(2.5);
			// Links and buttons of the summary are 44px targets.
			const small = await page
				.locator('[data-bond-summary]')
				.locator('a[href^="tel:"], a[class*="h-control"], button')
				.evaluateAll((nodes) =>
					nodes
						.map((node) => ({
							text: node.textContent?.trim(),
							h: node.getBoundingClientRect().height
						}))
						.filter((item) => item.h < 44)
				);
			expect(small).toEqual([]);
			const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
			expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
			await phone.close();
		});
});

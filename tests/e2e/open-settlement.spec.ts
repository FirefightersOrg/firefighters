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
 * UX plan, PR 7 (audit A1, A4, A8; decision P4). The open settlement: a payment is the bond number,
 * Enter, Enter; every payment names its bond; removing one asks for the reason in a dialog; on a
 * phone the task bar takes the place of the campaign tabs; «Registrar pago» on the campaign leads to
 * the collector's open settlement.
 */
const baseURL = `http://127.0.0.1:${process.env.E2E_PORT ?? 4317}`;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const FIRST = 300;
const SECOND = 301;

let admin: BrowserContext;
let campaignId: string;
let collector: string;
let settlementPath: string;

const numberField = (page: Page) => page.getByLabel('Número del bono que pagó');
const paymentRows = (page: Page) =>
	page.locator('[data-row-list][aria-label="Pagos de esta rendición"] [data-row]');

async function settlementPage() {
	const page = await admin.newPage();
	await open(page, settlementPath);
	return page;
}

test.describe.serial('open settlement: payments by bond number', () => {
	test.beforeAll(async ({ browser }) => {
		test.setTimeout(180_000);
		const run = runId();
		collector = `Cobrador ${run}`;
		admin = await browser.newContext({ baseURL, locale: 'es-AR' });
		const page = await admin.newPage();
		await login(page);
		campaignId = await createActiveCampaign(page, `E2E rendición ${run}`);
		await createCollector(page, campaignId, collector);
		for (const base of [FIRST, SECOND]) {
			await createBond(page, campaignId, base);
			await deliverAndSell(page, campaignId, collector, base);
		}
		await page.close();
	});

	test.afterAll(async () => {
		await admin?.close();
	});

	test('«Registrar pago» on the campaign opens the collector’s settlement, then leads back to it', async () => {
		const page = await admin.newPage();
		await open(page, `/campaigns/${campaignId}`);
		await page.getByRole('link', { name: 'Registrar pago' }).click();
		await expect(page.getByRole('heading', { name: 'Registrar pago', level: 1 })).toBeVisible();
		await page.locator('#collectorId').selectOption({ label: collector });
		await page.getByRole('button', { name: 'Abrir rendición y cargar pagos' }).click();
		await expect(page).toHaveURL(new RegExp(`/settlements/${UUID}$`));
		settlementPath = new URL(page.url()).pathname;
		await expect(
			page.getByRole('heading', { name: new RegExp(`^Rendición \\d+ de ${collector}$`), level: 1 })
		).toBeVisible();

		// The second time there is nothing to open: the page sends to the settlement that is open.
		await open(page, `/campaigns/${campaignId}`);
		await page.getByRole('link', { name: 'Registrar pago' }).click();
		await page.locator('#collectorId').selectOption({ label: collector });
		await expect(
			page.getByText(new RegExp(`${collector} ya tiene abierta la rendición`))
		).toBeVisible();
		await expect(page.getByRole('button', { name: /Abrir rendición/ })).toHaveCount(0);
		await page.getByRole('link', { name: /Cargar pagos en la rendición \d+/ }).click();
		await expect(page).toHaveURL(new RegExp(`${settlementPath}$`));
		await page.close();
	});

	test('a number that is not one of the collector’s sales says so and adds nothing', async () => {
		const page = await settlementPage();
		const number = numberField(page);
		await number.fill('999');
		await number.press('Enter');
		await expect(page.locator('#bond-number-status')).toContainText(
			`${collector} no tiene una venta con deuda para el bono 999. No se agregó ningún pago.`
		);
		await expect(number).toHaveAttribute('aria-invalid', 'true');
		await expect(page.locator('[data-found-sale]')).toHaveCount(0);
		await expect(page.getByRole('button', { name: /Agregar pago/ })).toHaveCount(0);
		// A second Enter does not post anything either.
		await number.press('Enter');
		await expect(page.getByText('Pago agregado.')).toHaveCount(0);
		await expect(paymentRows(page)).toHaveCount(0);
		// 30 is not 300: the whole number has to match.
		await number.fill('30');
		await expect(page.locator('#bond-number-status')).toBeEmpty();
		await number.press('Enter');
		await expect(page.locator('[data-found-sale]')).toHaveCount(0);
		await page.close();
	});

	test('number, Enter, Enter: the payment is added, named by its bond, and the focus is back', async () => {
		const page = await settlementPage();
		const number = numberField(page);
		await number.fill(String(FIRST));
		await number.press('Enter');
		const found = page.locator('[data-found-sale]');
		await expect(found).toContainText(String(FIRST));
		await expect(found).toContainText(`Ana Comprador ${collector}`);
		// The next installment comes checked and the button names the amount.
		await expect(found.getByRole('checkbox').first()).toBeChecked();
		await expect(page.getByRole('button', { name: /^Agregar pago de \$\s1\.000$/ })).toBeVisible();
		// Typing another number never leaves the previous bond ready to be paid.
		await number.fill(`${FIRST}0`);
		await expect(found).toHaveCount(0);
		await number.fill(String(FIRST));
		await number.press('Enter');
		await expect(found).toBeVisible();

		await number.press('Enter');
		await expect(page.getByText('Pago agregado.')).toBeVisible();
		await expect(number).toBeFocused();
		await expect(number).toHaveValue('');
		await expect(found).toHaveCount(0);
		const row = paymentRows(page).first();
		await expect(row).toContainText(String(FIRST));
		await expect(row).toContainText(`Ana Comprador ${collector}`);
		await expect(row).toContainText(/Cuota 1, efectivo, hoy/);
		await expect(page.locator('[data-settlement-totals]')).toContainText('Efectivo (1 pago)');
		await expect(page.locator('[data-settlement-totals]')).toContainText(
			`${collector} tiene que entregar`
		);

		// The same bond has no debt left: it cannot be paid twice.
		await number.fill(String(FIRST));
		await number.press('Enter');
		await expect(page.locator('#bond-number-status')).toContainText('no tiene una venta con deuda');

		// The second payment is by transfer, and goes first in the list.
		await number.fill(String(SECOND));
		await number.press('Enter');
		// The radio itself is visually hidden: the segment is its label.
		await page.locator('[data-found-sale]').getByText('Transferencia').click();
		await expect(page.getByRole('radio', { name: 'Transferencia' })).toBeChecked();
		await page.getByRole('button', { name: /^Agregar pago de/ }).click();
		await expect(paymentRows(page)).toHaveCount(2);
		await expect(paymentRows(page).first()).toContainText(String(SECOND));
		await expect(paymentRows(page).first()).toContainText(/transferencia/);
		await expect(page.locator('[data-settlement-totals]')).toContainText('Transferencias (1 pago)');
		await page.close();
	});

	test('removing a payment asks for the reason in a dialog', async () => {
		const page = await settlementPage();
		await expect(paymentRows(page)).toHaveCount(2);
		await page.getByLabel(`Acciones del pago del bono ${SECOND}`).click();
		await page.getByRole('button', { name: 'Quitar de la rendición' }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toContainText(`¿Quitar el pago del bono ${SECOND} de esta rendición?`);
		// Without a reason nothing is posted.
		await dialog.getByRole('button', { name: 'Quitar pago' }).click();
		await expect(dialog).toBeVisible();
		await expect(paymentRows(page)).toHaveCount(2);
		await dialog.getByLabel(/Motivo/).fill('Se cargó en la rendición equivocada.');
		await dialog.getByRole('button', { name: 'Quitar pago' }).click();
		await expect(page.getByText('Pago quitado.')).toBeVisible();
		await expect(dialog).toHaveCount(0);
		await expect(paymentRows(page)).toHaveCount(1);
		await expect(paymentRows(page).first()).toContainText(String(FIRST));
		await expect(page.locator('[data-settlement-totals]')).toContainText(
			'Transferencias (0 pagos)'
		);
		// It stays on record, apart from the payments that count.
		await page.getByText('1 pago quitado').click();
		const removed = page.locator('[data-row-list][aria-label="Pagos quitados de esta rendición"]');
		await expect(removed.locator('[data-row]')).toHaveCount(1);
		await expect(removed).toContainText(String(SECOND));
		await expect(removed).toContainText('Anulado');
		// The bond has its debt again, so it can be entered once more.
		const number = numberField(page);
		await number.fill(String(SECOND));
		await number.press('Enter');
		await expect(page.locator('[data-found-sale]')).toBeVisible();
		await page.close();
	});

	for (const scheme of ['light', 'dark'] as const)
		test(`phone: nothing cut at 375px, the task bar replaces the tabs, axe (${scheme})`, async ({
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
			await open(page, settlementPath);
			const number = numberField(page);
			await number.fill(String(SECOND));
			await page.locator('[data-payment-entry]').getByRole('button', { name: 'Buscar' }).click();
			await expect(page.locator('[data-found-sale]')).toBeVisible();

			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth
			);
			expect(overflow, 'the page does not scroll sideways').toBeLessThanOrEqual(0);
			// One bar at the thumb: the task bar, with the cash to hand over and the close.
			await expect(page.locator('[data-taskbar]')).toBeVisible();
			await expect(page.locator('[data-taskbar]')).toContainText('Entrega en efectivo');
			await expect(page.locator('[data-campaign-tabs]')).toBeHidden();
			// Every control of the entry is a 44px target.
			const small = await page
				.locator('[data-payment-entry]')
				.locator('input:not([type="hidden"]), button, label:has(input)')
				.evaluateAll((nodes) =>
					nodes
						.filter((node) => (node as HTMLElement).checkVisibility())
						.map((node) => {
							const box = (node.closest('label') ?? node).getBoundingClientRect();
							return {
								tag: node.tagName,
								text: node.textContent?.trim().slice(0, 30),
								h: box.height
							};
						})
						.filter((item) => item.h < 44)
				);
			expect(small, 'targets under 44px in the entry form').toEqual([]);

			const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
			expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);

			// The close is reached from the task bar; Esc leaves everything as it was.
			await page.getByRole('button', { name: 'Revisar y cerrar' }).click();
			const dialog = page.getByRole('dialog');
			await expect(dialog).toContainText(`${collector} entrega`);
			await page.keyboard.press('Escape');
			await expect(dialog).toHaveCount(0);
			await phone.close();
		});

	test('desktop: axe on the open settlement with a bond found (dark)', async ({ browser }) => {
		const desktop = await browser.newContext({
			baseURL,
			viewport: { width: 1280, height: 800 },
			colorScheme: 'dark',
			storageState: await admin.storageState(),
			locale: 'es-AR'
		});
		const page = await desktop.newPage();
		await open(page, settlementPath);
		await numberField(page).fill(String(SECOND));
		await numberField(page).press('Enter');
		await expect(page.locator('[data-found-sale]')).toBeVisible();
		// On desktop the tabs are not there and the close sits beside the sheet, not in a fixed bar.
		await expect(page.locator('[data-campaign-rail]')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Cerrar rendición' })).toBeVisible();
		const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
		expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
		await desktop.close();
	});

	test('the close is a primary action that shows the cash to hand over', async () => {
		const page = await settlementPage();
		await page.getByRole('button', { name: 'Cerrar rendición' }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toContainText('Una rendición cerrada no se reabre.');
		await expect(dialog).toContainText('Neto para Bomberos');
		await expect(dialog).toContainText(`${collector} entrega`);
		await dialog.getByRole('button', { name: 'Cerrar rendición' }).click();
		await expect(page.getByText('Rendición cerrada.')).toBeVisible();
		await expect(page.getByText('Cerrada', { exact: true }).first()).toBeVisible();
		// Closed: the entry is gone and the sheet is the document.
		await expect(numberField(page)).toHaveCount(0);
		await expect(
			page.getByRole('link', { name: 'Imprimir remito de rendición' }).first()
		).toBeVisible();
		await page.close();
	});
});

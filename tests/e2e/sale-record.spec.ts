import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { resolveSeedConfig } from '../../scripts/seed-admin';
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
 * UX plan, PR 12b (audit A9 and A10). The sale record: the first screen says the sale and what is
 * owed, the installments follow, and the corrections and the uncollectible mark are collapsed and
 * ask for their reason in a dialog. The four actions are the ones the page had.
 */
const baseURL = `http://127.0.0.1:${process.env.E2E_PORT ?? 4317}`;
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const BOND = 620;

let admin: BrowserContext;
let campaignId: string;
let saleId: string;
let seller: string;
let other: string;

const record = () => `/campaigns/${campaignId}/sales/${saleId}`;
const sentence = (page: Page) => page.locator('[data-sale-sentence]');
const lead = (page: Page) => page.locator('[data-sale-lead]');
/** Opens the collapsed corrections and the dialog of one of them. */
async function ask(page: Page, button: string) {
	await page.getByText('Corregir la venta', { exact: true }).click();
	await page.locator('[data-sale-corrections]').getByRole('button', { name: button }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toBeVisible();
	return dialog;
}

test.describe.serial('sale record', () => {
	test.beforeAll(async ({ browser }) => {
		test.setTimeout(240_000);
		const run = runId();
		// Names that do not contain each other: the buyer created inline carries the seller's name.
		seller = `Vendedor ${run}`;
		other = `Reemplazo ${run}`;
		admin = await browser.newContext({ baseURL, locale: 'es-AR' });
		const page = await admin.newPage();
		await login(page);
		campaignId = await createActiveCampaign(page, `E2E ficha de venta ${run}`);
		await createCollector(page, campaignId, seller);
		await createCollector(page, campaignId, other);
		await createBond(page, campaignId, BOND);
		({ saleId } = await deliverAndSell(page, campaignId, seller, BOND));
		await page.close();
	});

	test.afterAll(async () => {
		await admin?.close();
	});

	test('the first screen says who bought the bond, who collects it and what is owed', async () => {
		const page = await admin.newPage();
		await open(page, record());
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Venta del bono 0${BOND}`);
		await expect(lead(page)).toContainText('Falta cobrar');
		await expect(lead(page)).toContainText('$ 1.000');
		await expect(sentence(page)).toContainText(`compró el bono 0${BOND} el`);
		await expect(sentence(page)).toContainText('en un pago, por $ 1.000.');
		await expect(sentence(page)).toContainText(`Lo cobra ${seller}.`);
		await expect(sentence(page)).toContainText('Debe $ 1.000, que vence el');
		// The bond, the buyer and the collector are links to their records.
		await expect(sentence(page).getByRole('link', { name: `0${BOND}` })).toHaveAttribute(
			'href',
			/\/bonds\/[0-9a-f-]{36}$/
		);
		await expect(sentence(page).getByRole('link', { name: seller, exact: true })).toHaveAttribute(
			'href',
			/\/collectors\/[0-9a-f-]{36}$/
		);
		await expect(sentence(page).locator('a[href*="/buyers/"]')).toHaveCount(1);
		await expect(page.locator('[data-installment]')).toHaveCount(1);
		// The corrections are collapsed: nothing of them is on the first screen.
		await expect(page.getByRole('button', { name: 'Corregir el comprador' })).toBeHidden();
		await expect(page.getByText(/Unknown|Sin acceso/)).toHaveCount(0);
		await page.close();
	});

	test('«Registrar pago» leads to the settlement of the sale’s collector', async () => {
		const page = await admin.newPage();
		await open(page, record());
		await page.getByRole('link', { name: 'Registrar pago' }).click();
		await expect(page).toHaveURL(/\/settlements\/new\?intent=payment&collector=[0-9a-f-]{36}$/);
		await expect(page.locator('#collectorId')).toHaveValue(/[0-9a-f-]{36}/);
		await page.close();
	});

	test('a correction asks for the reason in a dialog and nothing is sent without it', async () => {
		const page = await admin.newPage();
		await open(page, record());
		const dialog = await ask(page, 'Corregir el cobrador');
		await expect(dialog).toContainText(`¿Corregir el cobrador de la venta del bono 0${BOND}?`);
		await expect(dialog).toContainText(`Hoy figura ${seller}.`);
		const confirm = dialog.getByRole('button', { name: 'Corregir el cobrador' });
		await expect(confirm).toBeDisabled();
		// The collector the sale already has is not offered as the correct one.
		await expect(dialog.locator('#newCollectorId option', { hasText: seller })).toHaveCount(0);
		await dialog.locator('#newCollectorId').selectOption({ label: other });
		await expect(confirm).toBeDisabled();
		await dialog.getByLabel('Motivo').fill('La vendió el otro cobrador');
		await confirm.click();
		await expect(page.getByText('Cobrador corregido.')).toBeVisible();
		await expect(dialog).toBeHidden();
		await expect(sentence(page)).toContainText(`Lo cobra ${other}.`);
		await page.close();
	});

	test('a correction the server rejects stays in its dialog, with the error and what was typed', async () => {
		const page = await admin.newPage();
		await open(page, record());
		const dialog = await ask(page, 'Corregir el cobrador');
		await dialog.locator('#newCollectorId').selectOption({ label: seller });
		const reason = 'x'.repeat(1001);
		await dialog.getByLabel('Motivo').fill(reason);
		await dialog.getByRole('button', { name: 'Corregir el cobrador' }).click();
		await expect(dialog.getByRole('alert')).toBeVisible();
		await expect(dialog).toBeVisible();
		await expect(dialog.getByLabel('Motivo')).toHaveValue(reason);
		await expect(dialog.locator('#newCollectorId')).not.toHaveValue('');
		await dialog.getByRole('button', { name: 'Cancelar' }).click();
		await expect(sentence(page)).toContainText(`Lo cobra ${other}.`);
		await page.close();
	});

	test('marking the sale as uncollectible, and reverting it, each ask for the reason', async () => {
		const page = await admin.newPage();
		await open(page, record());
		const mark = await ask(page, 'Marcar como incobrable');
		await expect(mark).toContainText('Solo un administrador puede revertir la marca.');
		// A destructive dialog opens with the focus on «Cancelar».
		await expect(mark.getByRole('button', { name: 'Cancelar' })).toBeFocused();
		await expect(mark.getByRole('button', { name: 'Marcar como incobrable' })).toBeDisabled();
		await mark.getByLabel('Motivo').fill('Se mudó sin aviso');
		await mark.getByRole('button', { name: 'Marcar como incobrable' }).click();
		await expect(page.getByText('Venta marcada como incobrable.')).toBeVisible();
		await expect(lead(page)).toContainText('Quedó sin cobrar');
		await expect(page.getByText('Se mudó sin aviso')).toBeVisible();
		await expect(sentence(page)).toContainText('Se dio por incobrable');
		await expect(page.getByRole('link', { name: 'Registrar pago' })).toHaveCount(0);

		// The corrections stayed open after the answer; the mark is now the one to revert.
		await page
			.locator('[data-sale-corrections]')
			.getByRole('button', { name: 'Revertir la marca' })
			.click();
		const revert = page.getByRole('dialog');
		await expect(revert.getByLabel('Motivo')).toHaveValue('');
		await revert.getByLabel('Motivo').fill('Volvió a pagar');
		await revert.getByRole('button', { name: 'Revertir la marca' }).click();
		await expect(page.getByText('Se revirtió la marca de incobrable.')).toBeVisible();
		await expect(lead(page)).toContainText('Falta cobrar');
		await expect(page.getByRole('link', { name: 'Registrar pago' })).toBeVisible();
		await page.close();
	});

	test('the keyboard opens a correction, and Esc closes it and returns the focus', async () => {
		const page = await admin.newPage();
		await open(page, record());
		const summary = page.locator('summary', { hasText: 'Corregir la venta' });
		await summary.focus();
		await page.keyboard.press('Enter');
		const trigger = page
			.locator('[data-sale-corrections]')
			.getByRole('button', { name: 'Corregir el comprador' });
		await trigger.focus();
		await page.keyboard.press('Enter');
		await expect(page.getByRole('dialog')).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog')).toBeHidden();
		await expect(trigger).toBeFocused();
		await page.close();
	});

	test('a role without sale permissions reads the sale and is offered nothing', async ({
		browser
	}) => {
		const readOnly = resolveSeedConfig().fixtures.find((user) =>
			user.roleNames.includes('read-only')
		)!;
		const context = await browser.newContext({ baseURL, locale: 'es-AR' });
		const page = await context.newPage();
		await login(page, readOnly);
		await open(page, record());
		await expect(sentence(page)).toContainText(`el bono 0${BOND}`);
		await expect(page.getByText('Sin permiso para ver los pagos')).toBeVisible();
		await expect(page.getByText('Corregir la venta')).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Registrar pago' })).toHaveCount(0);
		await expect(page.getByText(/Unknown|Sin acceso/)).toHaveCount(0);
		await context.close();
	});

	for (const colorScheme of ['light', 'dark'] as const) {
		test(`375 px [${colorScheme}]: the record and a correction dialog are clean`, async ({
			browser
		}) => {
			const context = await browser.newContext({
				baseURL,
				locale: 'es-AR',
				viewport: { width: 375, height: 812 },
				hasTouch: true,
				colorScheme,
				storageState: await admin.storageState()
			});
			const page = await context.newPage();
			await open(page, record());
			const overflow = () =>
				page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);
			expect(await overflow()).toBeLessThanOrEqual(1);
			await page.getByText('Corregir la venta', { exact: true }).tap();
			// Every control of the record is a 44 px target; links inside the sentence are text.
			const small = await page.evaluate(() =>
				[...document.querySelectorAll('main a, main button, main summary')]
					.filter(
						(node) =>
							(node as HTMLElement).offsetParent !== null && !node.closest('[data-sale-sentence]')
					)
					.map((node) => ({
						text: node.textContent?.trim().slice(0, 40),
						height: Math.round(node.getBoundingClientRect().height)
					}))
					.filter((node) => node.height < 44)
			);
			expect(small).toEqual([]);
			const closed = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
			expect(closed.violations).toEqual([]);

			await page
				.locator('[data-sale-corrections]')
				.getByRole('button', { name: 'Corregir el comprador' })
				.tap();
			const dialog = page.getByRole('dialog');
			await expect(dialog).toBeVisible();
			const box = await dialog.boundingBox();
			expect(box!.x).toBeGreaterThanOrEqual(0);
			expect(box!.x + box!.width).toBeLessThanOrEqual(375);
			expect(await overflow()).toBeLessThanOrEqual(1);
			const opened = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
			expect(opened.violations).toEqual([]);
			await context.close();
		});
	}
});

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import {
	baDay,
	createActiveCampaign,
	createBond,
	createCollector,
	deliverAndSell,
	login,
	open,
	runId
} from './helpers';

/**
 * UX plan, PR 13 (audit A7 and A10). The campaign home: find a bond, the day's actions, what waits
 * for someone («Para resolver», each item leading to where it is resolved and gone once resolved),
 * one line of figures, the balances and the next draw. Each role sees its own part.
 */
const baseURL = `http://127.0.0.1:${process.env.E2E_PORT ?? 4317}`;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const BOND = 630;

let admin: BrowserContext;
let campaignId: string;
let collector: string;
let drawName: string;

const home = () => `/campaigns/${campaignId}`;
const todo = (page: Page) => page.locator('#dash-todo');
const actions = (page: Page) => page.locator('[data-day-actions]');

test.describe.serial('campaign home', () => {
	test.beforeAll(async ({ browser }) => {
		test.setTimeout(240_000);
		const run = runId();
		collector = `Cobrador ${run}`;
		drawName = `Final ${run}`;
		admin = await browser.newContext({ baseURL, locale: 'es-AR' });
		const page = await admin.newPage();
		await login(page);
		campaignId = await createActiveCampaign(page, `E2E inicio ${run}`);
		await createCollector(page, campaignId, collector);
		await createBond(page, campaignId, BOND);
		await deliverAndSell(page, campaignId, collector, BOND);
		await page.close();
	});

	test.afterAll(async () => {
		await admin?.close();
	});

	test('with nothing waiting there is no «Para resolver»; the search and the four actions lead', async () => {
		const page = await admin.newPage();
		await open(page, home());
		await expect(todo(page)).toHaveCount(0);
		await expect(actions(page).getByRole('link')).toHaveText([
			'Registrar venta',
			'Registrar pago',
			'Entregar bonos',
			'Cargar bonos'
		]);
		await expect(page.locator('#dash-figures')).toContainText('Bonos vendidos');
		// The search opens the record of the one bond with that number.
		const search = page.getByRole('main').getByRole('search', { name: 'Buscar bono' });
		await search.getByLabel('Número de bono').fill(String(BOND));
		await search.getByRole('button', { name: 'Buscar bono' }).click();
		await expect(page).toHaveURL(new RegExp(`/bonds/${UUID}$`));
		await page.close();
	});

	test('an open settlement is listed and leads to the open settlements', async () => {
		const page = await admin.newPage();
		await open(page, `${home()}/settlements/new`);
		await page.locator('#collectorId').selectOption({ label: collector });
		await page.getByRole('button', { name: 'Abrir rendición' }).click();
		await expect(page).toHaveURL(new RegExp(`/settlements/${UUID}$`));

		await open(page, home());
		const item = todo(page).locator('[data-task="open-settlements"]');
		await expect(item).toContainText('1 rendición abierta');
		await item.getByRole('link').click();
		await expect(page).toHaveURL(new RegExp(`/settlements\\?status=open$`));
		await expect(page.getByRole('main')).toContainText(collector);
		await page.close();
	});

	test('a sold bond that may miss the next draw is named under its item, with its record one tap away', async () => {
		const page = await admin.newPage();
		await open(page, `${home()}/draws/new`);
		await page.locator('#drawType').selectOption('final');
		await page.locator('#name').fill(drawName);
		await page.locator('#drawDate').fill(baDay(1));
		await page.locator('#paymentCutoffLocal').fill(`${baDay(0)}T23:59`);
		await page.getByRole('button', { name: 'Crear sorteo' }).click();
		await expect(page).toHaveURL(new RegExp(`/draws/${UUID}$`));

		await open(page, home());
		const item = todo(page).locator('[data-task^="draw-"]');
		await expect(item).toContainText(`1 bono vendido puede quedar fuera de «${drawName}»`);
		await expect(item).toContainText('El corte es hoy');
		// The bonds are collapsed until asked for.
		const bond = item.locator('[data-at-risk-bond]');
		await expect(bond).toBeHidden();
		await item.locator('summary').click();
		await expect(bond).toHaveCount(1);
		await expect(bond).toContainText(`0${BOND}`);
		await expect(bond).toContainText(`Lo cobra ${collector}`);
		await expect(page.locator('#dash-next-draw')).toContainText(drawName);
		await bond.getByRole('link').click();
		await expect(page).toHaveURL(new RegExp(`/bonds/${UUID}$`));
		await page.close();
	});

	for (const colorScheme of ['light', 'dark'] as const) {
		test(`375 px [${colorScheme}]: nothing is cut, every control is a target, axe`, async ({
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
			await open(page, home());
			await todo(page).locator('[data-task^="draw-"] summary').tap();
			await expect(page.locator('[data-at-risk-bond]')).toBeVisible();
			expect(
				await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)
			).toBeLessThanOrEqual(1);
			// The home's own controls (the close checklist at the end is its own component).
			const small = await page.evaluate(() =>
				[
					...document.querySelectorAll(
						'main form[role="search"] :is(input, button), [data-day-actions] a, #dash-todo :is(a, summary), main section h2 ~ a, #dash-balances a'
					)
				]
					.filter((node) => (node as HTMLElement).offsetParent !== null)
					.map((node) => ({
						text: node.textContent?.trim().slice(0, 40),
						height: Math.round(node.getBoundingClientRect().height)
					}))
					.filter((node) => node.height < 44)
			);
			expect(small).toEqual([]);
			const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
			expect(results.violations).toEqual([]);
			await context.close();
		});
	}

	test('each role sees its own part of the home', async ({ browser }) => {
		const fixtures = resolveSeedConfig().fixtures;
		const as = async (role: string) => {
			const context = await browser.newContext({ baseURL, locale: 'es-AR' });
			const page = await context.newPage();
			await login(
				page,
				fixtures.find((user) => user.roleNames.includes(role))!
			);
			await open(page, home());
			return { context, page };
		};

		// The operator does the day's work: every action, what waits, no balances.
		const operator = await as('operator');
		await expect(actions(operator.page).getByRole('link')).toHaveCount(4);
		await expect(todo(operator.page).locator('[data-task="open-settlements"]')).toBeVisible();
		await expect(operator.page.locator('#dash-figures')).toBeVisible();
		await expect(operator.page.locator('#dash-balances')).toHaveCount(0);
		await operator.context.close();

		// The treasurer records payments and sees the balances.
		const treasurer = await as('treasurer');
		await expect(actions(treasurer.page).getByRole('link')).toHaveText(['Registrar pago']);
		await expect(treasurer.page.locator('#dash-balances')).toBeVisible();
		await treasurer.context.close();

		// Read-only: no action, no settlements; the figures, and the draw without a link.
		const readOnly = await as('read-only');
		await expect(actions(readOnly.page)).toHaveCount(0);
		await expect(todo(readOnly.page).locator('[data-task="open-settlements"]')).toHaveCount(0);
		await expect(todo(readOnly.page).locator('[data-task^="draw-"]')).toBeVisible();
		await expect(readOnly.page.locator('#dash-figures')).toBeVisible();
		await expect(readOnly.page.locator('#dash-next-draw')).toContainText(drawName);
		await expect(readOnly.page.locator('#dash-next-draw a[href*="/draws/"]')).toHaveCount(0);
		await readOnly.context.close();
	});

	test('once the bond is paid and the settlement closed, nothing is left to resolve', async () => {
		const page = await admin.newPage();
		await open(page, home());
		await todo(page).locator('[data-task="open-settlements"]').getByRole('link').click();
		await page
			.getByRole('main')
			.getByRole('link', { name: /^#\d+$/ })
			.first()
			.click();
		await expect(page).toHaveURL(new RegExp(`/settlements/${UUID}$`));
		await page.waitForLoadState('networkidle');
		const number = page.getByLabel('Número del bono que pagó');
		await number.fill(String(BOND));
		await number.press('Enter');
		await expect(page.locator('[data-found-sale]')).toBeVisible();
		await number.press('Enter');
		await expect(page.getByText('Pago agregado.')).toBeVisible();
		await page.getByRole('button', { name: 'Cerrar rendición' }).first().click();
		await page.getByRole('dialog').getByRole('button', { name: 'Cerrar rendición' }).click();
		await expect(page.getByText('Rendición cerrada.')).toBeVisible();

		await open(page, home());
		await expect(todo(page)).toHaveCount(0);
		await expect(page.getByText('Para resolver')).toHaveCount(0);
		// The draw is still the next one; it just has no bond left out.
		await expect(page.locator('#dash-next-draw')).toContainText(drawName);
		await page.close();
	});
});

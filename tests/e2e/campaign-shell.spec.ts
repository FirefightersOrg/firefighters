import { expect, test, type BrowserContext } from '@playwright/test';
import { createActiveCampaign, createBond, login, open, runId } from './helpers';

/**
 * UX plan, PR 5: the campaign shell. The sections are a rail from 1024px and a bottom tab bar below
 * it; this checks what a render test cannot: that every section is reachable by tapping and by
 * keyboard, that «Más» opens and closes properly, that the bond search in the top bar works, and
 * that the fixed bar never covers the end of a page.
 */
const baseURL = `http://127.0.0.1:${process.env.E2E_PORT ?? 4317}`;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

let campaignId: string;
let desktop: BrowserContext;
let phone: BrowserContext;

test.describe.serial('campaign shell', () => {
	test.beforeAll(async ({ browser }) => {
		const seed = await browser.newContext({ baseURL, locale: 'es-AR' });
		const page = await seed.newPage();
		await login(page);
		campaignId = await createActiveCampaign(page, `E2E shell ${runId()}`);
		await createBond(page, campaignId, 100);
		const storageState = await seed.storageState();
		await seed.close();
		desktop = await browser.newContext({
			baseURL,
			locale: 'es-AR',
			viewport: { width: 1280, height: 800 },
			storageState
		});
		phone = await browser.newContext({
			baseURL,
			locale: 'es-AR',
			viewport: { width: 375, height: 812 },
			hasTouch: true,
			storageState
		});
	});

	test.afterAll(async () => {
		await desktop?.close();
		await phone?.close();
	});

	test('desktop: the rail reaches every section and marks the current one', async () => {
		const page = await desktop.newPage();
		await open(page, `/campaigns/${campaignId}`);
		const rail = page.getByRole('navigation', { name: 'Secciones de la campaña', exact: true });
		await expect(rail).toBeVisible();
		await expect(
			page.getByRole('navigation', { name: 'Secciones de la campaña, barra inferior' })
		).toBeHidden();
		await expect(rail.getByRole('link', { name: 'Inicio' })).toHaveAttribute(
			'aria-current',
			'page'
		);

		for (const [label, path] of [
			['Bonos', 'bonds'],
			['Entregas', 'deliveries'],
			['Ventas', 'sales'],
			['Rendiciones', 'settlements'],
			['Cobradores', 'collectors'],
			['Compradores', 'buyers'],
			['Sorteos', 'draws'],
			['Reportes', 'reports'],
			['Datos y reglas', 'configuracion'],
			['Reglas de comisión', 'commissions'],
			['Registro de auditoría', 'audit'],
			['Copias de seguridad', 'backups']
		]) {
			await rail.getByRole('link', { name: label, exact: true }).click();
			await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}/${path}$`));
			// Exactly one section is current, and it is the one just opened.
			await expect(rail.locator('[aria-current="page"]')).toHaveCount(1);
			await expect(rail.getByRole('link', { name: label, exact: true })).toHaveAttribute(
				'aria-current',
				'page'
			);
		}
		// A page deep inside a section keeps that section current.
		await open(page, `/campaigns/${campaignId}/bonds/new`);
		await expect(rail.getByRole('link', { name: 'Bonos', exact: true })).toHaveAttribute(
			'aria-current',
			'page'
		);
		await page.close();
	});

	test('desktop: the top bar names the institution and finds a bond', async () => {
		const page = await desktop.newPage();
		await open(page, `/campaigns/${campaignId}/sales`);
		const brand = page.getByRole('banner').getByRole('link').first();
		await expect(brand).toContainText('Bomberos Voluntarios');
		await expect(brand).toContainText('E2E shell');
		await expect(page.getByRole('banner')).not.toContainText('Firefighters');

		const search = page.getByRole('banner').getByRole('search', { name: 'Buscar bono' });
		await search.getByRole('textbox', { name: 'Número de bono' }).fill('100');
		await page.keyboard.press('Enter');
		// UX plan PR 9: a number that matches one bond opens its record, with no list in between.
		await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}/bonds/[0-9a-f-]{36}$`));
		await expect(page.locator('main')).toContainText('0100');
		// A number that matches nothing stays on the list, which says so.
		await search.getByRole('textbox', { name: 'Número de bono' }).fill('9999');
		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}/bonds\\?base=9999$`));
		await expect(page.getByText('Ningún bono coincide con los filtros')).toBeVisible();

		// The brand goes back to the campaign's home, which has its own search instead.
		await brand.click();
		await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}$`));
		await expect(page.getByRole('banner').getByRole('search')).toHaveCount(0);
		await page.close();
	});

	test('keyboard: the skip link is first and moves focus to the content', async () => {
		const page = await desktop.newPage();
		await open(page, `/campaigns/${campaignId}/sales`);
		await page.keyboard.press('Tab');
		const skip = page.getByRole('link', { name: 'Ir al contenido' });
		await expect(skip).toBeFocused();
		await expect(skip).toBeVisible();
		await page.keyboard.press('Enter');
		await expect(page.locator('main#contenido')).toBeFocused();
		await page.close();
	});

	test('phone: four tabs and «Más» reach every section', async () => {
		const page = await phone.newPage();
		await open(page, `/campaigns/${campaignId}`);
		const tabs = page.getByRole('navigation', { name: 'Secciones de la campaña, barra inferior' });
		await expect(tabs).toBeVisible();
		await expect(
			page.getByRole('navigation', { name: 'Secciones de la campaña', exact: true })
		).toBeHidden();

		// The bar is fixed to the bottom of the screen, and each tab is at least 56px tall.
		const bar = (await tabs.boundingBox())!;
		expect(Math.round(bar.y + bar.height)).toBe(812);
		const heights = await tabs
			.locator('ul')
			.first()
			.locator('a, button')
			.evaluateAll((items) => items.map((item) => item.getBoundingClientRect().height));
		expect(heights).toHaveLength(5);
		for (const height of heights) expect(height).toBeGreaterThanOrEqual(56);

		await tabs.getByRole('link', { name: 'Rendiciones' }).tap();
		await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}/settlements$`));
		await expect(tabs.getByRole('link', { name: 'Rendiciones' })).toHaveAttribute(
			'aria-current',
			'page'
		);

		// «Más» holds the rest: it opens, Esc closes it and returns focus, and a link in it navigates.
		const more = tabs.getByRole('button', { name: 'Más' });
		await expect(more).toHaveAttribute('aria-expanded', 'false');
		await expect(tabs.getByRole('link', { name: 'Sorteos' })).toBeHidden();
		await more.tap();
		await expect(more).toHaveAttribute('aria-expanded', 'true');
		await expect(tabs.getByRole('link', { name: 'Sorteos' })).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(tabs.getByRole('link', { name: 'Sorteos' })).toBeHidden();
		await expect(more).toBeFocused();

		await more.tap();
		await tabs.getByRole('link', { name: 'Sorteos' }).tap();
		await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}/draws$`));
		// Navigating closes the sheet, and «Más» says the current section is one of its own.
		await expect(tabs.getByRole('link', { name: 'Sorteos' })).toBeHidden();
		await expect(more).toContainText('sección actual');

		// Tapping outside closes it too.
		await more.tap();
		await page.getByRole('button', { name: 'Cerrar el menú' }).tap({ position: { x: 20, y: 80 } });
		await expect(more).toHaveAttribute('aria-expanded', 'false');
		await page.close();
	});

	test('phone: the search opens from the top bar', async () => {
		const page = await phone.newPage();
		await open(page, `/campaigns/${campaignId}/sales`);
		const toggle = page.getByRole('button', { name: 'Buscar un bono' });
		await expect(toggle).toHaveAttribute('aria-expanded', 'false');
		await toggle.tap();
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');
		// By role: the desktop copy of the field is in the DOM but not displayed, so not in the tree.
		const field = page.getByRole('banner').getByRole('textbox', { name: 'Número de bono' });
		await expect(field).toBeVisible();
		await field.fill('100');
		await page.getByRole('banner').getByRole('button', { name: 'Buscar bono' }).tap();
		await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}/bonds/[0-9a-f-]{36}$`));
		await page.close();
	});

	test('phone: the tab bar never covers the end of a page', async () => {
		const page = await phone.newPage();
		for (const path of ['', '/bonds', '/sales/new', '/deliveries/new', '/configuracion']) {
			await open(page, `/campaigns/${campaignId}${path}`);
			await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
			const gap = await page.evaluate(() => {
				const bar = document.querySelector('[data-campaign-tabs]')!.getBoundingClientRect();
				const content = document.querySelector('main#contenido')!;
				// The lowest visible box inside the page content.
				let bottom = 0;
				for (const el of content.querySelectorAll<HTMLElement>('*')) {
					const box = el.getBoundingClientRect();
					// checkVisibility: the content of a closed <details> has a box but is not rendered.
					if (box.width && box.height && el.checkVisibility({ contentVisibilityAuto: true }))
						bottom = Math.max(bottom, box.bottom);
				}
				return bar.top - bottom;
			});
			expect(gap, `${path || '/'}: content ends above the tab bar`).toBeGreaterThanOrEqual(0);
		}
		await page.close();
	});

	test('printable documents keep their own page, without the shell', async () => {
		const page = await desktop.newPage();
		await open(page, `/campaigns/${campaignId}/bonds`);
		// Deliver the bond so there is a delivery note to print.
		await open(page, `/campaigns/${campaignId}/collectors/new`);
		await page.locator('#displayName').fill('Cobrador shell');
		await page.locator('form:has(#displayName) button:not([type="button"])').click();
		await expect(page).not.toHaveURL(/collectors\/new/);
		await open(page, `/campaigns/${campaignId}/deliveries/new`);
		await page.locator('#query').fill('100');
		await page.getByRole('button', { name: 'Agregar' }).click();
		await expect(page.getByText('1 bono agregado.')).toBeVisible();
		await page.locator('#collectorId').selectOption({ label: 'Cobrador shell' });
		await page.getByRole('button', { name: 'Entregar 1 bono a Cobrador shell' }).click();
		await expect(page).toHaveURL(new RegExp(`/deliveries/${UUID}$`));
		await expect(page.locator('[data-campaign-rail]')).toHaveCount(1);
		await open(page, `${new URL(page.url()).pathname}/print`);
		await expect(page.locator('[data-campaign-rail]')).toHaveCount(0);
		await expect(page.locator('[data-campaign-tabs]')).toHaveCount(0);
		await page.close();
	});
});

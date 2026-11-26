import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type BrowserContext } from '@playwright/test';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import { createActiveCampaign, login, open, runId } from './helpers';

/**
 * UX plan, PR 6. Error pages in Spanish inside the shell with a way back (audit A13), the home that
 * goes straight to the work (A11), the single «Volver a …» link instead of the breadcrumb trail, and
 * the institution's name in page titles.
 */
const baseURL = `http://127.0.0.1:${process.env.E2E_PORT ?? 4317}`;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const MISSING = '00000000-0000-4000-8000-000000000000';
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

let campaignId: string;
let admin: BrowserContext;
let readOnly: BrowserContext;
let collector: BrowserContext;

async function signedIn(browser: Browser, user?: { email: string; password: string }) {
	const context = await browser.newContext({ baseURL, locale: 'es-AR' });
	await login(await context.newPage(), user);
	return context;
}

test.describe.serial('error pages, landing and the back link', () => {
	test.beforeAll(async ({ browser }) => {
		const fixtures = resolveSeedConfig().fixtures;
		const fixture = (role: string) => fixtures.find((user) => user.roleNames.includes(role))!;
		admin = await signedIn(browser);
		const page = await admin.newPage();
		campaignId = await createActiveCampaign(page, `E2E errores ${runId()}`);
		await page.close();
		readOnly = await signedIn(browser, fixture('read-only'));
		collector = await signedIn(browser, fixture('collector'));
	});

	test.afterAll(async () => {
		await admin?.close();
		await readOnly?.close();
		await collector?.close();
	});

	test('404 inside a campaign: in the shell, in Spanish, with the way back to its list', async () => {
		const page = await admin.newPage();
		const response = await page.goto(`/campaigns/${campaignId}/bonds/${MISSING}`);
		expect(response?.status()).toBe(404);
		await page.waitForLoadState('networkidle');
		// Still inside the campaign shell: the sections are one click away.
		await expect(page.locator('[data-campaign-rail]')).toBeVisible();
		const error = page.locator('[data-error-page]');
		await expect(error.getByRole('heading', { level: 1 })).toHaveText('No se encontró');
		await expect(error).toContainText('Error 404');
		await expect(page.locator('body')).not.toContainText('Not Found');
		await expect(error.getByRole('link', { name: 'Volver a intentar' })).toHaveCount(0);

		await error.getByRole('link', { name: 'Volver a Bonos' }).click();
		await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}/bonds$`));
		await expect(page.getByRole('heading', { name: 'Bonos', level: 1 })).toBeVisible();
		await page.close();
	});

	test('403 inside a campaign: says whose section it is, never «Forbidden»', async () => {
		const page = await readOnly.newPage();
		const response = await page.goto(`/campaigns/${campaignId}/settlements`);
		expect(response?.status()).toBe(403);
		await page.waitForLoadState('networkidle');
		await expect(page.locator('[data-campaign-rail]')).toBeVisible();
		const error = page.locator('[data-error-page]');
		await expect(error.getByRole('heading', { level: 1 })).toHaveText('Sin acceso a esta sección');
		await expect(error).toContainText('Esta sección es de tesorería.');
		await expect(page.locator('body')).not.toContainText('Forbidden');
		// The role does not see that section in the rail either.
		await expect(
			page.locator('[data-campaign-rail]').getByRole('link', { name: 'Rendiciones' })
		).toHaveCount(0);

		await error.getByRole('link', { name: 'Ir al inicio de la campaña' }).click();
		await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}$`));
		await page.close();
	});

	test('403 and 404 outside a campaign: under the plain header, with the way to the list', async () => {
		const page = await readOnly.newPage();
		const denied = await page.goto('/campaigns/new');
		expect(denied?.status()).toBe(403);
		await page.waitForLoadState('networkidle');
		await expect(page.getByRole('banner')).toContainText('Bomberos Voluntarios');
		await expect(page.locator('[data-error-page]')).toContainText('Sin acceso a esta sección');
		await expect(page.locator('body')).not.toContainText('Forbidden');

		// A campaign that does not exist: no shell to show, the plain header instead.
		const missing = await page.goto(`/campaigns/${MISSING}`);
		expect(missing?.status()).toBe(404);
		await page.waitForLoadState('networkidle');
		await expect(page.locator('[data-campaign-rail]')).toHaveCount(0);
		const error = page.locator('[data-error-page]');
		await expect(error).toContainText('Campaña no encontrada.');
		await error.getByRole('link', { name: 'Ir a las campañas' }).click();
		await expect(page).toHaveURL(/\/campaigns$/);
		await page.close();
	});

	test('404 in the portal: under the portal header, with the way to its home', async () => {
		const page = await collector.newPage();
		const response = await page.goto(`/portal/${campaignId}/ventas/${MISSING}`);
		expect(response?.status()).toBe(404);
		await page.waitForLoadState('networkidle');
		const error = page.locator('[data-error-page]');
		await expect(error.getByRole('heading', { level: 1 })).toHaveText('No se encontró');
		await expect(page.locator('body')).not.toContainText('Not Found');
		await error.getByRole('link', { name: 'Ir a mi portal' }).click();
		await expect(page).toHaveURL(/\/portal/);
		await page.close();
	});

	for (const scheme of ['light', 'dark'] as const) {
		test(`an error page passes axe and has 44px targets on a phone (${scheme})`, async ({
			browser
		}) => {
			const context = await browser.newContext({
				baseURL,
				locale: 'es-AR',
				viewport: { width: 375, height: 812 },
				hasTouch: true,
				colorScheme: scheme,
				storageState: await readOnly.storageState()
			});
			const page = await context.newPage();
			await page.goto(`/campaigns/${campaignId}/settlements`);
			await page.waitForLoadState('networkidle');
			const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
			expect(
				results.violations
					.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))
					.map((v) => v.id)
			).toEqual([]);
			const heights = await page
				.locator('[data-error-page] a')
				.evaluateAll((links) => links.map((link) => link.getBoundingClientRect().height));
			expect(heights.length).toBeGreaterThan(0);
			for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
			const overflow = await page.evaluate(
				() => document.scrollingElement!.scrollWidth - window.innerWidth
			);
			expect(overflow).toBeLessThanOrEqual(1);
			await context.close();
		});
	}

	test('the home goes straight to the work', async () => {
		const page = await admin.newPage();
		// How many campaigns are active decides it: exactly one, that campaign; otherwise the list.
		await open(page, '/campaigns');
		const active = await page.getByRole('row').filter({ hasText: 'Activa' }).count();
		await open(page, '/');
		await expect(page).toHaveURL(active === 1 ? new RegExp(`/campaigns/${UUID}$`) : /\/campaigns$/);
		await expect(page.getByText('Sesión activa')).toHaveCount(0);
		await page.close();

		// A collector still lands on the portal.
		const own = await collector.newPage();
		await open(own, '/');
		await expect(own).toHaveURL(/\/portal/);
		await own.close();
	});

	test('one link back to the parent, and none where the shell already links', async () => {
		const page = await admin.newPage();
		await open(page, `/campaigns/${campaignId}/sales/new`);
		const back = page.locator('[data-back-link]');
		await expect(back).toHaveCount(1);
		await expect(back).toHaveText(/Volver a Ventas/);
		await expect(page.getByRole('navigation', { name: 'Ruta de navegación' })).toHaveCount(0);
		await back.click();
		await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}/sales$`));
		// A section's list and the campaign's home: the shell already has those links.
		await expect(page.locator('[data-back-link]')).toHaveCount(0);
		await open(page, `/campaigns/${campaignId}`);
		await expect(page.locator('[data-back-link]')).toHaveCount(0);
		// Outside a campaign there is no shell, so the link to the list stays.
		await open(page, '/campaigns/new');
		await expect(page.locator('[data-back-link]')).toHaveText(/Volver a Campañas/);
		await page.close();
	});

	test('page titles name the institution', async ({ browser }) => {
		const anonymous = await browser.newContext({ baseURL, locale: 'es-AR' });
		const login = await anonymous.newPage();
		await open(login, '/login');
		await expect(login).toHaveTitle('Iniciar sesión - Bomberos Voluntarios');
		await expect(login.getByText('Bomberos Voluntarios', { exact: true })).toBeVisible();
		await anonymous.close();

		const page = await admin.newPage();
		for (const path of [
			'/campaigns',
			`/campaigns/${campaignId}`,
			`/campaigns/${campaignId}/bonds`
		]) {
			await open(page, path);
			const title = await page.title();
			expect(title, path).toContain('Bomberos Voluntarios');
			expect(title, path).not.toContain('Firefighters');
		}
		await page.close();
	});
});

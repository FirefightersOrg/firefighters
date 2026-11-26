import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { findDemoIds, signedInClient, type DemoIds } from '../../scripts/demo-screens';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import { seedDemo } from '../../scripts/seed-demo';
import { OPERATIONAL_VIEWS, FINANCIAL_VIEWS } from '../../src/lib/report-views';
import { baDay, createDraftCampaign, login, open, runId } from './helpers';

let ids: DemoIds;
test.use({ hasTouch: true });
const campaign = () => `/campaigns/${ids.campaign}`;
test.beforeAll(async () => {
	await seedDemo();
	const config = resolveSeedConfig();
	ids = await findDemoIds(
		await signedInClient(config.supabaseUrl, process.env.PUBLIC_SUPABASE_ANON_KEY!, config.admin)
	);
});
test.beforeEach(async ({ page }) => {
	await login(page);
});

test('legacy report URLs still work, tabs preserve filters and paging keeps the complete export', async ({
	page
}) => {
	await open(page, `${campaign()}/reports?collector=${ids.collector}&month=2026-11`);
	await expect(
		page.getByRole('heading', { name: 'Bonos por estado comercial y financiero', exact: true })
	).toBeVisible();
	await page
		.getByRole('navigation', { name: 'Vistas del reporte' })
		.getByRole('link', { name: 'Resumen mensual' })
		.click();
	await expect(page).toHaveURL(/view=monthly/);
	let url = new URL(page.url());
	expect(url.searchParams.get('collector')).toBe(ids.collector);
	expect(url.searchParams.get('month')).toBe('2026-11');
	await page.goBack();
	await expect(page).not.toHaveURL(/view=monthly/);
	await open(page, `${campaign()}/reports/financial?collector=${ids.collector}`);
	await expect(
		page.getByRole('heading', { name: 'Detalle de la cuenta', exact: true })
	).toBeVisible();
	await open(page, `${campaign()}/reports/financial?draw=${ids.finishedDraw}`);
	await expect(page.getByRole('heading', { name: /Números del padrón:/ })).toBeVisible();
	const csv = page.getByRole('link', { name: 'Exportar CSV', exact: true });
	const href = await csv.getAttribute('href');
	await page
		.getByRole('navigation', { name: 'Páginas del reporte' })
		.getByRole('link', { name: 'Siguiente' })
		.click();
	await expect(page).toHaveURL(/page=2/);
	url = new URL(page.url());
	expect(url.searchParams.get('draw')).toBe(ids.finishedDraw);
	expect(await csv.getAttribute('href')).toBe(href);
	const [download] = await Promise.all([page.waitForEvent('download'), csv.click()]);
	expect(download.suggestedFilename()).toMatch(/\.csv$/);
	expect(await download.failure()).toBeNull();
});

for (const theme of ['light', 'dark'] as const) {
	test(`all report views and administration pass axe, fit 375 px and keep 44 px controls (${theme})`, async ({
		page
	}) => {
		test.setTimeout(300_000);
		await page.setViewportSize({ width: 375, height: 812 });
		await page.emulateMedia({ colorScheme: theme });
		const routes = [
			...OPERATIONAL_VIEWS.map((v) => ({ path: `/reports?view=${v.id}`, report: true })),
			...FINANCIAL_VIEWS.map((v) => ({
				path: `/reports/financial?view=${v.id}${v.id === 'ledger' ? `&collector=${ids.collector}` : v.id === 'roster' ? `&draw=${ids.finishedDraw}` : ''}`,
				report: true
			})),
			...['audit', 'commissions', 'configuracion', 'backups'].map((path) => ({
				path: `/${path}`,
				report: false
			}))
		];
		for (const route of routes) {
			await open(page, campaign() + route.path);
			await page.evaluate(
				(value) => document.documentElement.setAttribute('data-theme', value),
				theme
			);
			await page.evaluate(() => document.fonts.ready);
			expect(
				await page.evaluate(
					() => document.scrollingElement!.scrollWidth - document.documentElement.clientWidth
				),
				route.path
			).toBeLessThanOrEqual(1);
			if (route.report) {
				const metrics = await page.evaluate(() => ({
					height: document.scrollingElement!.scrollHeight,
					width: innerWidth,
					clientWidth: document.documentElement.clientWidth,
					overflow: document.scrollingElement!.scrollWidth - document.documentElement.clientWidth,
					screens: document.scrollingElement!.scrollHeight / 812
				}));
				console.info(
					'[ux17-report-metrics]',
					JSON.stringify({ theme, path: route.path, ...metrics })
				);
				expect(metrics.screens, route.path).toBeLessThanOrEqual(6);
			}
			expect((await new AxeBuilder({ page }).analyze()).violations, route.path).toEqual([]);
			const small = await page
				.locator('main a, main button, main input:not([type=hidden]), main select, main summary')
				.evaluateAll((nodes) =>
					nodes
						.filter((el) => {
							const input = el as HTMLInputElement;
							const target =
								input.type === 'radio' || input.type === 'checkbox'
									? (el.closest('label') ?? el)
									: el;
							const rect = target.getBoundingClientRect();
							return rect.width > 0 && rect.height > 0 && rect.height < 44;
						})
						.map((el) => el.textContent?.trim() || el.getAttribute('name'))
				);
			expect(small, route.path).toEqual([]);
		}
	});
}

test('report tabs and audit filters work from the keyboard; codes appear only in Detail', async ({
	page
}) => {
	await page.setViewportSize({ width: 375, height: 812 });
	await open(page, `${campaign()}/reports`);
	const monthly = page
		.getByRole('navigation', { name: 'Vistas del reporte' })
		.getByRole('link', { name: 'Resumen mensual' });
	await monthly.focus();
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(/view=monthly/);
	await open(page, `${campaign()}/audit`);
	await page.getByLabel('Nombre de la persona').fill('Jorge Medina');
	await page.getByLabel('Nombre de la persona').press('Enter');
	await expect(page).toHaveURL(/person=Jorge/);
	const rows = page.locator('main tbody');
	await expect(rows).toContainText('Jorge Medina');
	expect(await rows.innerText()).not.toMatch(
		/\b[a-z_]+\.[a-z_]+\b|[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}/
	);
	await rows.getByRole('link', { name: 'Detalle', exact: true }).first().click();
	await expect(page.locator('#audit-detail')).toContainText(/\b[a-z_]+\.[a-z_]+\b/);
});

test('data and rule changes ask for confirmation, keep their fields, and return focus on cancel', async ({
	page
}) => {
	const id = await createDraftCampaign(page, `UX17 datos ${runId()}`);
	await open(page, `/campaigns/${id}/configuracion`);
	await page.getByLabel('Nombre', { exact: true }).fill(`UX17 actualizado ${runId()}`);
	const save = page.getByRole('button', { name: 'Guardar datos generales', exact: true });
	await save.click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText('¿Guardar los datos de la campaña?');
	await page.keyboard.press('Escape');
	await expect(save).toBeFocused();
	await save.click();
	await dialog.getByRole('button', { name: 'Guardar datos generales', exact: true }).click();
	await expect(page.locator('#general [role="status"]')).toContainText('Cambios guardados.');
	await page.getByLabel('Valor del bono simple', { exact: false }).fill('1200');
	await page.getByLabel(/Se revisaron estos cambios/).check();
	const ruleForm = page.locator('form[action="?/rules"]');
	const fields = await ruleForm.evaluate((form) =>
		Array.from(new FormData(form as HTMLFormElement).entries()).map(([key, value]) => [
			key,
			String(value)
		])
	);
	await page.getByRole('button', { name: 'Guardar reglas', exact: true }).click();
	await expect(dialog).toContainText('¿Guardar las reglas de la campaña?');
	const posted = page.waitForRequest(
		(req) => req.method() === 'POST' && new URL(req.url()).search === '?/rules'
	);
	await dialog.getByRole('button', { name: 'Guardar reglas', exact: true }).click();
	const request = await posted;
	expect([...new URLSearchParams(request.postData() ?? '')]).toEqual(fields);
	await expect(page.locator('#summary')).toContainText('1.200');
});

test('commission create, edit and annul keep their actions behind dialogs', async ({ page }) => {
	const id = await createDraftCampaign(page, `UX17 comisión ${runId()}`);
	await open(page, `/campaigns/${id}/commissions`);
	await page.locator('summary').filter({ hasText: 'Agregar una regla' }).click();
	await page.getByLabel('Tipo de regla', { exact: true }).selectOption('cash_full_payment');
	await page.getByLabel('Porcentaje (%)', { exact: true }).fill('10');
	await page.getByLabel('Vigente desde', { exact: true }).fill(baDay());
	await page.getByRole('button', { name: 'Agregar regla', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText('¿Guardar esta regla de comisión?');
	await dialog.getByRole('button', { name: 'Guardar regla', exact: true }).click();
	await expect(page.locator('#rules')).toContainText('10');
	await page.locator('summary').filter({ hasText: 'Agregar una regla' }).click();
	await page
		.locator('#rules')
		.getByRole('link', { name: /Editar regla/ })
		.click();
	await expect(page.locator('#edit-percentage')).toBeVisible();
	await page.locator('#edit-percentage').fill('12');
	await page.getByRole('button', { name: 'Guardar regla', exact: true }).click();
	await dialog.getByRole('button', { name: 'Guardar regla', exact: true }).click();
	await expect(page.locator('#rules')).toContainText('12');
	await page
		.locator('#rules')
		.getByRole('button', { name: /Anular regla:/ })
		.click();
	await page
		.getByRole('dialog')
		.getByLabel('Motivo', { exact: true })
		.fill('Regla de prueba reemplazada');
	await page.getByRole('dialog').getByRole('button', { name: 'Anular regla', exact: true }).click();
	await expect(page.locator('#rules')).toContainText('Anulada');
});

test('backup period filters keep the original export links', async ({ page }) => {
	await open(page, `${campaign()}/backups`);
	await page.locator('summary').filter({ hasText: 'Filtrar por período' }).click();
	await page.getByLabel(/^Desde/).fill('2026-11-01');
	await page.getByLabel(/^Hasta/).fill('2026-11-20');
	const links = await page
		.getByRole('link', { name: 'Descargar CSV', exact: true })
		.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')));
	expect(links).toContain(`${campaign()}/backups/export/payments?from=2026-11-01&to=2026-11-20`);
	expect(links).toContain(`${campaign()}/backups/export/bonds`);
});

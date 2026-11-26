import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { login, open } from './helpers';

/**
 * UX plan, PR 4. The list components of the UI kit, exercised on the dev showcase (`/dev/ui`): what
 * a server render test cannot see. Keyboard operation, focus, the GET form, the stacked table on a
 * phone, the fixed task bar, and axe in light and dark.
 */
const baseURL = `http://127.0.0.1:${process.env.E2E_PORT ?? 4317}`;
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

let desktop: BrowserContext;
let phone: BrowserContext;

async function showcase(context: BrowserContext): Promise<Page> {
	const page = await context.newPage();
	await open(page, '/dev/ui');
	return page;
}

test.describe.serial('UI kit: list components', () => {
	test.beforeAll(async ({ browser }) => {
		const signIn = await browser.newContext({ baseURL, locale: 'es-AR' });
		await login(await signIn.newPage());
		const storageState = await signIn.storageState();
		await signIn.close();
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

	test('SegmentedControl: arrows move and select inside the group', async () => {
		const page = await showcase(desktop);
		const demo = page.locator('[data-demo="segmented"]');
		const cash = demo.getByRole('radio', { name: 'Efectivo' });
		const transfer = demo.getByRole('radio', { name: 'Transferencia' });
		await expect(cash).toBeChecked();
		await cash.focus();
		await page.keyboard.press('ArrowRight');
		await expect(transfer).toBeChecked();
		await expect(transfer).toBeFocused();
		await expect(demo.locator('[data-demo-value]')).toHaveText('Elegido: transfer');
		await page.keyboard.press('ArrowLeft');
		await expect(cash).toBeChecked();
		// The whole segment is the target, not only its text.
		await demo.getByText('Transferencia').click();
		await expect(transfer).toBeChecked();
		await page.close();
	});

	test('RowActions: Esc closes and returns focus; a destructive action asks first', async () => {
		const page = await showcase(desktop);
		const demo = page.locator('[data-demo="rows"]');
		const trigger = demo.locator('summary[aria-label="Acciones del pago del bono 0019"]');
		const remove = demo.getByRole('button', { name: 'Quitar de la rendición' }).first();

		await trigger.click();
		await expect(trigger).toHaveAttribute('aria-expanded', 'true');
		await expect(remove).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(remove).toBeHidden();
		await expect(trigger).toBeFocused();

		// A click outside closes it too.
		await trigger.click();
		await expect(remove).toBeVisible();
		await page.getByRole('heading', { name: 'TaskBar' }).click();
		await expect(remove).toBeHidden();

		// Choosing the destructive entry opens a dialog; nothing happens until it is confirmed.
		await trigger.focus();
		await page.keyboard.press('Enter');
		await remove.click();
		const dialog = page.getByRole('dialog');
		await expect(dialog.getByText('¿Quitar el pago del bono 0019?')).toBeVisible();
		await expect(demo.locator('[data-demo-action]')).toHaveText('Última acción: ninguna');
		await dialog.getByRole('button', { name: 'Quitar pago' }).click();
		await expect(demo.locator('[data-demo-action]')).toHaveText('Última acción: quitar 0019');
		await page.close();
	});

	test('FilterBar: a GET form that puts the search and the filters in the URL', async () => {
		const page = await showcase(desktop);
		const demo = page.locator('[data-demo="filters"]');
		await demo.getByLabel('Número de bono').fill('181');
		await demo.getByRole('button', { name: 'Buscar' }).click();
		await expect(page).toHaveURL(/\/dev\/ui\?base=181/);

		const filters = page.locator('[data-demo="filters"]');
		await expect(filters.getByLabel('Estado comercial')).toBeHidden();
		await filters.getByText('Filtrar', { exact: false }).first().click();
		await filters.getByLabel('Estado comercial').selectOption('Vendido');
		await filters.getByRole('button', { name: 'Aplicar filtros' }).click();
		await expect(page).toHaveURL(/status=Vendido/);

		// Each applied filter is a link to the list without it.
		await expect(
			page.getByRole('link', { name: 'Quitar el filtro Estado: Vendido' })
		).toHaveAttribute('href', '/dev/ui?type=simple');
		await page.close();
	});

	test('Table: stacked rows on a phone, columns on a desktop', async () => {
		const wide = await showcase(desktop);
		const header = wide.locator('[data-demo="table"]').getByRole('columnheader', { name: 'Valor' });
		await expect(header).toBeVisible();
		await wide.close();

		const page = await showcase(phone);
		const table = page.locator('[data-demo="table"]');
		const row = table.getByRole('row').nth(1);
		// Still a table for assistive tech, with its header row (visually hidden).
		await expect(table.getByRole('table')).toBeVisible();
		await expect(table.getByRole('columnheader')).toHaveCount(6);
		await expect(row.getByRole('cell')).toHaveCount(6);
		const box = async (text: string) => (await row.getByText(text, { exact: true }).boundingBox())!;
		const bond = await box('0181 / 5181');
		const value = await box('$ 60.000');
		const buyer = await box('Stella Rodríguez');
		// First line: the bond on the left, the value at the end. Second line: the buyer.
		expect(Math.abs(bond.y - value.y)).toBeLessThan(8);
		expect(value.x).toBeGreaterThan(bond.x + bond.width);
		expect(buyer.y).toBeGreaterThan(bond.y + bond.height - 2);
		// A column without a role is a line labelled with its header; a hidden one is not shown.
		await expect(row.getByText('Héctor Acosta')).toBeVisible();
		await expect(row.getByRole('cell').nth(5)).toBeHidden();
		const label = await row
			.getByRole('cell')
			.nth(3)
			.evaluate((cell) => getComputedStyle(cell, '::before').content);
		expect(label).toContain('Cobrador');
		// Nothing scrolls sideways: neither the page nor the table.
		const overflow = await page.evaluate(
			() => document.scrollingElement!.scrollWidth - window.innerWidth
		);
		expect(overflow).toBeLessThanOrEqual(1);
		await page.close();
	});

	test('TaskBar: fixed to the bottom on a phone, a block on a desktop', async () => {
		const page = await showcase(phone);
		const bar = page.getByRole('region', { name: 'Cierre de la rendición' });
		await expect(bar).toBeVisible();
		const box = (await bar.boundingBox())!;
		expect(Math.round(box.y + box.height)).toBe(812);
		expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
		// The page ends with room for it: the last content is not under the bar.
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		const last = (await page.locator('[data-demo="taskbar"] p').boundingBox())!;
		expect(last.y + last.height).toBeLessThanOrEqual((await bar.boundingBox())!.y);
		await page.close();

		const wide = await showcase(desktop);
		expect(
			await wide
				.getByRole('region', { name: 'Cierre de la rendición' })
				.evaluate((el) => getComputedStyle(el).position)
		).toBe('static');
		await wide.close();
	});

	for (const scheme of ['light', 'dark'] as const) {
		test(`axe on the showcase (${scheme})`, async ({ browser }) => {
			const context = await browser.newContext({
				baseURL,
				locale: 'es-AR',
				viewport: { width: 1280, height: 800 },
				colorScheme: scheme,
				storageState: await desktop.storageState()
			});
			const page = await showcase(context);
			// Open a row menu and the filters, so their content is checked too.
			await page.locator('summary[aria-label="Acciones del pago del bono 0019"]').click();
			await page.locator('[data-demo="filters"] summary').click();
			const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
			const serious = results.violations.filter((v) =>
				['serious', 'critical'].includes(v.impact ?? '')
			);
			expect(
				serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
			).toEqual([]);
			await context.close();
		});
	}

	test('touch targets are at least 44px on a phone', async () => {
		const page = await showcase(phone);
		await page.locator('summary[aria-label="Acciones del pago del bono 0019"]').click();
		const small = await page.evaluate(() =>
			[
				...document.querySelectorAll<HTMLElement>(
					'[data-demo] a[href], [data-demo] button, [data-demo] summary, [data-demo] label:has(input[type=radio]), [data-demo] input:not([type=radio]):not([type=hidden]), [data-demo] select'
				)
			]
				.filter((el) => {
					const box = el.getBoundingClientRect();
					if (!box.width) return false;
					if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') return false;
					return box.height < 44;
				})
				.map(
					(el) =>
						`${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 24)}" ${Math.round(el.getBoundingClientRect().height)}px`
				)
		);
		expect(small).toEqual([]);
		await page.close();
	});
});

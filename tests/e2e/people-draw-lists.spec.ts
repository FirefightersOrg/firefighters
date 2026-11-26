import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import { apiActiveCampaign, apiBond, apiDraw, rpc } from './api';
import { ANONYMOUS, STATE } from './auth-state';
import { baDay, login, open, runId } from './helpers';

/**
 * UX plan, PR 14b (audit A7 and A9). The collectors, buyers and draws lists of a campaign: the
 * search first and the other filters folded, every filter kept in the query string, rows that name
 * the person or the draw and then the one or two facts people look for, and stacked rows on a phone
 * that never scroll sideways, 60-character names included.
 *
 * The data is built through the audited SQL functions (`api.ts`): this spec checks the lists, not
 * the flows that create what they show.
 */
const baseURL = `http://127.0.0.1:${process.env.E2E_PORT ?? 4317}`;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
/** Buyers created for the paging test: one page (25) and one more. */
const PAGED_BUYERS = 26;

let run: string;
let campaignId: string;
/** A collector with two bonds and a balance against them; its name is 60 characters long. */
let longCollector: string;
/** A collector without bonds, with a balance in their favour. */
let otherCollector: string;
let inactiveCollector: string;
/** A business with a 60-character name, a phone and one bond. */
let longBuyer: string;
let draws: { next: string; later: string; annulled: string };

const list = (name: 'collectors' | 'buyers' | 'draws', search = '') =>
	`/campaigns/${campaignId}/${name}${search}`;
const sixty = (prefix: string) => `${prefix} ${'Chacabuco '.repeat(6)}`.slice(0, 60).trimEnd();

test.describe.serial('collectors, buyers and draws lists', () => {
	test.beforeAll(async () => {
		test.setTimeout(180_000);
		run = runId();
		campaignId = await apiActiveCampaign(`E2E listas ${run}`);

		longCollector = sixty(`Cobradora ${run} de la Cooperativa Eléctrica de`);
		otherCollector = `Otro ${run}`;
		inactiveCollector = `Inactivo ${run}`;
		const collector = (name: string, extra: Record<string, unknown> = {}) =>
			rpc('collector_create', {
				p_display_name: name,
				p_phone: '2364 55-9034',
				p_address: null,
				p_user_profile_id: null,
				...extra
			});
		const longCollectorId = await collector(longCollector);
		const otherCollectorId = await collector(otherCollector);
		await collector(inactiveCollector, { p_status: 'inactive' });

		// Two bonds delivered to the first collector; one of them sold to the business.
		const bonds = [await apiBond(campaignId, 310), await apiBond(campaignId, 311)];
		await rpc('bond_deliver', {
			p_campaign_id: campaignId,
			p_collector_id: longCollectorId,
			p_bond_ids: bonds,
			p_notes: null
		});
		longBuyer = sixty(`Cooperativa ${run} de Provisión de Servicios de`);
		const buyer = (fields: Record<string, unknown>) =>
			rpc('buyer_create', {
				p_type: 'individual',
				p_first_name: null,
				p_last_name: null,
				p_document_number: null,
				p_tax_id: null,
				p_business_name: null,
				p_phone: null,
				p_address: null,
				p_usual_collector_id: null,
				...fields
			});
		const businessId = await buyer({
			p_type: 'business',
			p_business_name: longBuyer,
			p_tax_id: `30-${run}-9`,
			p_phone: '+54 (236) 455-9034',
			p_usual_collector_id: longCollectorId
		});
		await rpc('sale_register', {
			p_campaign_id: campaignId,
			p_bond_id: bonds[0],
			p_buyer_id: businessId,
			p_payment_mode: 'full_payment',
			p_first_due_date: null,
			p_sale_date: baDay(0)
		});
		for (let i = 0; i < PAGED_BUYERS; i += 1)
			await buyer({
				p_first_name: `Persona ${String(i).padStart(2, '0')}`,
				p_last_name: `Paginado${run}`
			});

		// One balance against a collector and one in favour of the other.
		const adjust = (collectorId: string, direction: string, amount: string) =>
			rpc('collector_ledger_adjust', {
				p_campaign_id: campaignId,
				p_collector_id: collectorId,
				p_amount: amount,
				p_direction: direction,
				p_reason: 'Ajuste de prueba E2E'
			});
		await adjust(longCollectorId, 'collector_debit', '250.00');
		await adjust(otherCollectorId, 'collector_credit', '1200.00');

		// Three draws: the next one (tomorrow), a later one, and one annulled.
		const draw = (name: string, day: number) =>
			rpc('draw_create', {
				p_campaign_id: campaignId,
				p_draw_type: 'monthly',
				p_name: name,
				p_draw_date: baDay(day),
				p_payment_cutoff_at: `${baDay(day - 1)}T23:59:00-03:00`,
				p_required_installment_number: 1,
				p_eligibility_rule: {}
			});
		draws = {
			next: `Sorteo próximo ${run}`,
			later: `Sorteo posterior ${run}`,
			annulled: `Sorteo anulado ${run}`
		};
		await draw(draws.later, 30);
		await apiDraw(campaignId, draws.next, null);
		const annulledId = await draw(draws.annulled, 10);
		await rpc('draw_annul', { p_draw_id: annulledId, p_reason: 'Sorteo de prueba E2E' });
	});

	test('collectors: the row says the bonds and the balance; the name opens the record', async ({
		page
	}) => {
		await open(page, list('collectors', `?q=${run}`));
		const rows = page.locator('tbody tr');
		await expect(rows).toHaveCount(3);
		const long = rows.filter({ hasText: longCollector });
		await expect(long).toContainText('A cargo del cobrador $ 250');
		await expect(long.getByRole('cell').nth(1)).toContainText('2');
		const other = rows.filter({ hasText: otherCollector });
		await expect(other).toContainText('A favor del cobrador $ 1.200');
		await expect(other.getByRole('cell').nth(1)).toContainText('0');
		await expect(rows.filter({ hasText: inactiveCollector })).toContainText('Sin saldo');
		await expect(rows.filter({ hasText: inactiveCollector })).toContainText('Inactivo');
		await expect(page.locator('main')).not.toContainText(/Unknown|undefined/);

		await long.getByRole('link', { name: longCollector }).click();
		await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}/collectors/${UUID}$`));
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(longCollector);
	});

	test('collectors: the search and the folded status filter live in the query string', async ({
		page
	}) => {
		await open(page, list('collectors'));
		const status = page.locator('#filter-status');
		await expect(status).toBeHidden();
		await page.getByLabel('Nombre, teléfono o correo').fill(run);
		await page
			.locator('[data-filter-bar]')
			.getByRole('button', { name: 'Buscar', exact: true })
			.click();
		await expect(page).toHaveURL(new RegExp(`/collectors\\?q=${run}`));
		await expect(page.locator('[data-collector-id]')).toHaveCount(3);

		await page.locator('[data-filter-bar] summary').click();
		await status.selectOption('inactive');
		await page.getByRole('button', { name: 'Aplicar filtros' }).click();
		await expect(page).toHaveURL(new RegExp(`/collectors\\?q=${run}&status=inactive$`));
		await expect(page.locator('[data-collector-id]')).toHaveCount(1);
		await expect(page.getByLabel('Nombre, teléfono o correo')).toHaveValue(run);

		// The chip removes the status and keeps the search.
		await page.getByRole('link', { name: 'Quitar el filtro Estado: Inactivo' }).click();
		await expect(page).toHaveURL(new RegExp(`/collectors\\?q=${run}$`));
		await expect(page.locator('[data-collector-id]')).toHaveCount(3);

		await open(page, list('collectors', '?q=nadie-con-este-nombre&status=active'));
		await expect(page.getByText('Ningún cobrador coincide con la búsqueda')).toBeVisible();
		await page.getByRole('link', { name: 'Ver todos los cobradores' }).click();
		await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}/collectors$`));
	});

	test('collectors: a role that does not read the financial reports sees no balance', async ({
		browser
	}) => {
		const operator = resolveSeedConfig().fixtures.find((user) =>
			user.roleNames.includes('operator')
		);
		if (!operator) throw new Error('The operator fixture is missing: run seed:admin first.');
		const context = await browser.newContext({
			baseURL,
			locale: 'es-AR',
			storageState: ANONYMOUS
		});
		const page = await context.newPage();
		await login(page, operator);
		await open(page, list('collectors', `?q=${run}`));
		await expect(page.locator('[data-collector-id]')).toHaveCount(3);
		await expect(page.getByRole('columnheader', { name: 'Bonos asignados' })).toBeVisible();
		await expect(page.getByRole('columnheader', { name: 'Saldo' })).toHaveCount(0);
		await expect(page.locator('main')).not.toContainText(/Saldo|A favor|A cargo/);
		await context.close();
	});

	test('buyers: found by name, phone or tax id; the row has the phone and the bonds', async ({
		page
	}) => {
		for (const query of [`Cooperativa ${run}`, `30-${run}-9`]) {
			await open(page, list('buyers', `?q=${encodeURIComponent(query)}`));
			await expect(page.locator('[data-buyer-id]'), query).toHaveCount(1);
		}
		const row = page.locator('tbody tr').filter({ hasText: longBuyer });
		await expect(row.getByRole('link', { name: '+54 (236) 455-9034' })).toHaveAttribute(
			'href',
			'tel:+542364559034'
		);
		await expect(row.getByRole('cell').nth(2)).toContainText('1');
		await expect(row).toContainText('Empresa');
		await expect(row).toContainText(longCollector);

		await row.getByRole('link', { name: longBuyer }).click();
		await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}/buyers/${UUID}$`));
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(longBuyer);
	});

	test('buyers: the search and the type filter are kept across pages', async ({ page }) => {
		await open(page, list('buyers'));
		await page.getByLabel('Nombre, teléfono o documento').fill(`Paginado${run}`);
		await page.locator('[data-filter-bar] summary').click();
		await page.locator('#filter-type').selectOption('individual');
		await page.getByRole('button', { name: 'Aplicar filtros' }).click();
		await expect(page).toHaveURL(new RegExp(`/buyers\\?q=Paginado${run}&type=individual$`));
		await expect(page.getByText(`Mostrando 1–25 de ${PAGED_BUYERS} compradores`)).toBeVisible();
		await expect(page.locator('[data-buyer-id]')).toHaveCount(25);
		// A buyer without bonds says so; one without a phone has no link to dial.
		const first = page.locator('tbody tr').first();
		await expect(first.getByRole('cell').nth(2)).toContainText('0');
		await expect(first.locator('a[href^="tel:"]')).toHaveCount(0);

		await page.getByRole('link', { name: /Siguiente/ }).click();
		await expect(page).toHaveURL(new RegExp(`/buyers\\?q=Paginado${run}&type=individual&page=2$`));
		await expect(page.locator('[data-buyer-id]')).toHaveCount(PAGED_BUYERS - 25);
		await expect(page.getByLabel('Nombre, teléfono o documento')).toHaveValue(`Paginado${run}`);
		await expect(page.getByRole('link', { name: 'Quitar el filtro Tipo: Persona' })).toBeVisible();

		// Removing the type goes back to the first page of the same search.
		await page.getByRole('link', { name: 'Quitar el filtro Tipo: Persona' }).click();
		await expect(page).toHaveURL(new RegExp(`/buyers\\?q=Paginado${run}$`));

		await open(page, list('buyers', `?q=Paginado${run}&type=business`));
		await expect(page.getByText('Ningún comprador coincide con la búsqueda')).toBeVisible();
	});

	test('draws: a calendar with the next draw first; the filters live in the query string', async ({
		page
	}) => {
		await open(page, list('draws'));
		const pending = page.getByRole('table', { name: 'Sorteos por realizar' });
		await expect(pending.locator('[data-draw-id]')).toHaveText([draws.next, draws.later]);
		const done = page.getByRole('table', { name: 'Sorteos realizados o anulados' });
		await expect(done.locator('[data-draw-id]')).toHaveText([draws.annulled]);
		const next = pending.getByRole('row').filter({ hasText: draws.next });
		await expect(next).toContainText('Programado');
		const [year, month, day] = baDay(1).split('-');
		await expect(next).toContainText(`${day}/${month}/${year}`);
		await expect(next).toContainText('23:59');
		await expect(done.getByRole('row').filter({ hasText: draws.annulled })).toContainText(
			'Anulado'
		);

		const status = page.locator('#filter-status');
		await expect(status).toBeHidden();
		await page.locator('[data-draw-filters] summary').click();
		await status.selectOption('annulled');
		await page.locator('#filter-type').selectOption('monthly');
		await page.getByRole('button', { name: 'Aplicar filtros' }).click();
		await expect(page).toHaveURL(/\/draws\?type=monthly&status=annulled$/);
		await expect(page.locator('[data-draw-id]')).toHaveText([draws.annulled]);
		await expect(page.getByText('2 filtros aplicados')).toBeVisible();

		// Each chip removes its filter and keeps the other one.
		await page.getByRole('link', { name: 'Quitar el filtro Estado: Anulado' }).click();
		await expect(page).toHaveURL(/\/draws\?type=monthly$/);
		await expect(page.locator('[data-draw-id]')).toHaveText([draws.later, draws.annulled]);
		await page.getByRole('link', { name: 'Quitar todos' }).click();
		await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}/draws$`));

		await open(page, list('draws', '?status=completed'));
		await expect(page.getByText('Ningún sorteo coincide con los filtros')).toBeVisible();

		await open(page, list('draws'));
		await page.getByRole('link', { name: draws.next }).click();
		await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}/draws/${UUID}$`));
	});

	/** A 375 px phone signed in as the admin. */
	const phone = (browser: Browser, scheme: 'light' | 'dark') =>
		browser.newContext({
			baseURL,
			viewport: { width: 375, height: 800 },
			isMobile: true,
			hasTouch: true,
			colorScheme: scheme,
			storageState: STATE.admin,
			locale: 'es-AR'
		});
	/** The first row is in the first screen, nothing scrolls sideways, targets are 44 px, axe is clean. */
	async function expectPhoneList(page: Page, row: string, label: string) {
		const first = await page.locator(row).first().boundingBox();
		expect(first, `${label}: the first row is on the page`).not.toBeNull();
		expect(first!.y + first!.height, `${label}: the first row is in the first screen`).toBeLessThan(
			800
		);
		const { overflow, wide, tiny } = await page.evaluate(() => {
			const doc = document.scrollingElement!;
			// A table that scrolls inside its own container hides its columns too.
			const wide = [...document.querySelectorAll<HTMLElement>('table')].filter(
				(table) => table.parentElement!.scrollWidth > table.parentElement!.clientWidth + 1
			).length;
			const tiny = [
				...document.querySelectorAll<HTMLElement>('main a[href], main button, main summary')
			]
				.filter((el) => {
					const box = el.getBoundingClientRect();
					return box.width > 0 && box.height < 44;
				})
				.map((el) => `${(el.textContent ?? '').trim().slice(0, 30)} ${el.offsetHeight}px`);
			return { overflow: doc.scrollWidth - window.innerWidth, wide, tiny };
		});
		expect(overflow, `${label}: the page does not scroll sideways`).toBeLessThanOrEqual(0);
		expect(wide, `${label}: no table scrolls sideways inside its card`).toBe(0);
		expect(tiny, `${label}: targets under 44 px`).toEqual([]);
		const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
		expect(
			axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`),
			`${label}: axe`
		).toEqual([]);
	}

	for (const scheme of ['light', 'dark'] as const)
		test(`phone: stacked rows, the first one in the first screen, no sideways scroll, axe (${scheme})`, async ({
			browser
		}) => {
			test.setTimeout(180_000);
			const context = await phone(browser, scheme);
			const page = await context.newPage();

			// The unfiltered lists, as people open them.
			await open(page, list('collectors'));
			await expectPhoneList(page, '[data-collector-id]', 'collectors');
			await open(page, list('buyers'));
			await expectPhoneList(page, '[data-buyer-id]', 'buyers');
			await open(page, list('draws'));
			await expectPhoneList(page, '[data-draw-id]', 'draws');

			// 60-character names, with a filter applied (the chips take a line).
			await open(page, list('collectors', `?q=${run}&status=active`));
			await expectPhoneList(page, '[data-collector-id]', 'collectors with long names');
			const collectorRow = page.locator('tbody tr').filter({ hasText: longCollector });
			await expect(collectorRow.getByText('2 bonos')).toBeVisible();
			await expect(collectorRow.getByText('A cargo del cobrador')).toBeVisible();
			const collectorName = await collectorRow.getByRole('link').first().boundingBox();
			expect(collectorName!.x + collectorName!.width).toBeLessThanOrEqual(375);

			await open(page, list('buyers', `?q=${encodeURIComponent(`Cooperativa ${run}`)}`));
			await expectPhoneList(page, '[data-buyer-id]', 'buyers with long names');
			const buyerRow = page.locator('tbody tr').filter({ hasText: longBuyer });
			await expect(buyerRow.getByText('1 bono', { exact: true })).toBeVisible();
			const dial = buyerRow.locator('a[href^="tel:"]');
			await expect(dial).toBeVisible();
			const dialBox = await dial.boundingBox();
			expect(dialBox!.height, 'the phone is a 44 px target').toBeGreaterThanOrEqual(44);
			expect(dialBox!.x + dialBox!.width).toBeLessThanOrEqual(375);

			await open(page, list('draws', '?type=monthly&status=scheduled'));
			await expectPhoneList(page, '[data-draw-id]', 'draws with filters');

			// The folded filters, open.
			await open(page, list('buyers'));
			await page.locator('[data-filter-bar] summary').click();
			await expect(page.locator('#filter-type')).toBeVisible();
			await expectPhoneList(page, '[data-buyer-id]', 'buyers with the filters open');
			await context.close();
		});
});

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
	apiActiveCampaign,
	apiBond,
	apiBuyer,
	apiCollector,
	apiDeliverSellAndSettle,
	apiOpenSettlement,
	rpc
} from './api';
import { STATE } from './auth-state';
import { baDay, open, runId } from './helpers';

/**
 * UX plan, PR 14a (audit A7 and A9). The three operation lists of a campaign: sales, settlements
 * and delivery notes. A row names the thing as people say it, the filters are folded and live in
 * the query string, open settlements come first, and on a phone each row is two lines with the
 * first one in the first screen and nothing scrolling sideways, also with long names.
 */
const baseURL = `http://127.0.0.1:${process.env.E2E_PORT ?? 4317}`;
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const SETTLED = 710;
const SOLD = 711;
const DELIVERED = 712;
/** A pata of six: its numbers are wider than a phone row unless they wrap. */
const PATA = [721, 722, 723, 724, 725, 726];

let campaignId: string;
let longCollector: string;
let shortCollector: string;
let longBuyer: string;
let saleId: string;
let openSettlementId: string;
let closedSettlementId: string;
let noteId: string;

const list = (name: 'sales' | 'settlements' | 'deliveries', search = '') =>
	`/campaigns/${campaignId}/${name}${search}`;
const rows = (page: Page) => page.locator('main tbody tr');
const bar = (page: Page) => page.locator('main [data-filter-bar]');

test.describe.serial('operation lists: sales, settlements, delivery notes', () => {
	test.beforeAll(async () => {
		test.setTimeout(120_000);
		const run = runId();
		// Built through the audited SQL functions: the flows that create this data have their own specs.
		campaignId = await apiActiveCampaign(`E2E listas ${run}`);
		longCollector = `Cooperadora de la Escuela de Educación Técnica Número Tres ${run}`;
		shortCollector = `Cobrador ${run}`;
		const long = await apiCollector(longCollector);
		const short = await apiCollector(shortCollector);
		const [settled, sold, delivered] = [
			await apiBond(campaignId, SETTLED),
			await apiBond(campaignId, SOLD),
			await apiBond(campaignId, DELIVERED)
		];
		// Settlement 1 stays open; settlement 2, opened after it, is closed: the list has to put the
		// open one first although its number is lower.
		openSettlementId = await apiOpenSettlement(campaignId, long);
		closedSettlementId = (await apiDeliverSellAndSettle(campaignId, short, settled)).settlementId;
		// Delivery note 2 carries three bonds to the collector with the long name: one is sold to a
		// buyer with a long name, and the pata to another buyer.
		const pata = await rpc('bond_create', { p_campaign_id: campaignId, p_base_numbers: PATA });
		noteId = await rpc('bond_deliver', {
			p_campaign_id: campaignId,
			p_collector_id: long,
			p_bond_ids: [sold, delivered, pata],
			p_notes: null
		});
		const lastName = `Fernández de la Cruz y Villanueva ${run}`;
		longBuyer = `María de los Ángeles Guadalupe ${lastName}`;
		const buyerId = await apiBuyer('María de los Ángeles Guadalupe', lastName);
		saleId = await rpc('sale_register', {
			p_campaign_id: campaignId,
			p_bond_id: sold,
			p_buyer_id: buyerId,
			p_payment_mode: 'full_payment',
			p_first_due_date: null,
			p_sale_date: baDay(0)
		});
		await rpc('sale_register', {
			p_campaign_id: campaignId,
			p_bond_id: pata,
			p_buyer_id: await apiBuyer('Pedro', `Pata ${run}`),
			p_payment_mode: 'full_payment',
			p_first_due_date: null,
			p_sale_date: baDay(0)
		});
	});

	test('sales: a row names the bond and its buyer, and the number opens the sale', async ({
		page
	}) => {
		await open(page, list('sales'));
		await expect(rows(page)).toHaveCount(3);
		const row = rows(page).filter({ hasText: `0${SOLD}` });
		await expect(row).toContainText(longBuyer);
		await expect(row).toContainText(longCollector);
		await expect(row).toContainText('Sin pagos');
		await expect(row).toContainText('$ 1.000');
		await expect(rows(page).filter({ hasText: `0${SETTLED}` })).toContainText('Pagado');
		// A pata is one sale, named by all its numbers, for six times the value of a bond.
		const pata = rows(page).filter({ hasText: PATA.map((n) => `0${n}`).join(' + ') });
		await expect(pata).toContainText('$ 6.000');
		await expect(page.getByText('Mostrando 1–3 de 3 ventas')).toBeVisible();
		// One link per row, and no «Unknown» or cents.
		await expect(row.getByRole('link')).toHaveCount(1);
		await expect(page.locator('main')).not.toContainText(/Unknown|1\.000,00/);
		await row.getByRole('link', { name: `0${SOLD}` }).click();
		await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}/sales/${saleId}$`));
	});

	test('sales: the search and the folded filters keep each other in the query string', async ({
		page
	}) => {
		await open(page, list('sales'));
		await page.getByLabel('Nombre del comprador').fill('Villanueva');
		await bar(page).getByRole('button', { name: 'Buscar' }).click();
		await expect(page).toHaveURL(/[?&]buyer=Villanueva/);
		await expect(rows(page)).toHaveCount(1);
		await expect(page.getByLabel('Nombre del comprador')).toHaveValue('Villanueva');

		// The other filters are folded, and open from the keyboard.
		const status = page.locator('#filter-financial-status');
		await expect(status).toBeHidden();
		await bar(page).locator('summary').focus();
		await page.keyboard.press('Enter');
		await expect(status).toBeVisible();
		await status.selectOption({ label: 'Pagado' });
		await bar(page).getByRole('button', { name: 'Aplicar filtros' }).click();
		await expect(page).toHaveURL(/buyer=Villanueva.*financialStatus=fully_paid/);
		await expect(page.getByText('Ninguna venta coincide con los filtros')).toBeVisible();

		// What is applied is a chip; removing it keeps the search.
		await page.getByRole('link', { name: 'Quitar el filtro Pagos: Pagado' }).click();
		await expect(page).toHaveURL(/[?&]buyer=Villanueva/);
		await expect(page).not.toHaveURL(/financialStatus=/);
		await expect(rows(page)).toHaveCount(1);
	});

	test('settlements: the open one comes first, and «?status=open» lists only the open ones', async ({
		page
	}) => {
		await open(page, list('settlements'));
		await expect(rows(page)).toHaveCount(2);
		await expect(rows(page).nth(0)).toContainText('Rendición 1');
		await expect(rows(page).nth(0)).toContainText('Abierta');
		await expect(rows(page).nth(0)).toContainText(longCollector);
		await expect(rows(page).nth(0)).not.toContainText('$');
		await expect(rows(page).nth(1)).toContainText('Rendición 2');
		await expect(rows(page).nth(1)).toContainText('Cerrada');
		await expect(rows(page).nth(1)).toContainText('$ 1.000');
		await expect(page.getByText('2 rendiciones, 1 abierta')).toBeVisible();
		await expect(page.locator('main')).not.toContainText(/Unknown|#\d|1\.000,00/);

		// The link from the campaign home.
		await open(page, list('settlements', '?status=open'));
		await expect(rows(page)).toHaveCount(1);
		await expect(rows(page)).toContainText('Rendición 1');
		await page.getByRole('link', { name: 'Quitar el filtro Estado: Abierta' }).click();
		await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}/settlements$`));
		await expect(rows(page)).toHaveCount(2);
	});

	test('settlements: a folded filter keeps the one already applied, and the row opens the settlement', async ({
		page
	}) => {
		await open(page, list('settlements', '?status=closed'));
		const collector = page.locator('#filter-collector');
		await expect(collector).toBeHidden();
		await bar(page).locator('summary').click();
		await collector.selectOption({ label: shortCollector });
		await bar(page).getByRole('button', { name: 'Aplicar filtros' }).click();
		await expect(page).toHaveURL(/collector=[0-9a-f-]{36}.*status=closed/);
		await expect(
			page.getByRole('link', { name: `Quitar el filtro Cobrador: ${shortCollector}` })
		).toBeVisible();
		await expect(
			page.getByRole('link', { name: 'Quitar el filtro Estado: Cerrada' })
		).toBeVisible();
		await expect(rows(page)).toHaveCount(1);
		await rows(page).getByRole('link', { name: 'Rendición 2' }).click();
		await expect(page).toHaveURL(
			new RegExp(`/campaigns/${campaignId}/settlements/${closedSettlementId}$`)
		);
		// The open one is reached the same way.
		await open(page, list('settlements'));
		await rows(page).getByRole('link', { name: 'Rendición 1' }).click();
		await expect(page).toHaveURL(
			new RegExp(`/campaigns/${campaignId}/settlements/${openSettlementId}$`)
		);
	});

	test('delivery notes: a row says who the bonds went to and how many; the filters keep their query', async ({
		page
	}) => {
		await open(page, list('deliveries'));
		await expect(rows(page)).toHaveCount(2);
		await expect(rows(page).nth(0)).toContainText(`Remito 0002 a ${longCollector}`);
		await expect(rows(page).nth(0)).toContainText('3 bonos');
		await expect(rows(page).nth(0)).toContainText('Entrega');
		await expect(rows(page).nth(1)).toContainText(`Remito 0001 a ${shortCollector}`);
		await expect(rows(page).nth(1)).toContainText('1 bono');
		await expect(page.getByText('Mostrando 1–2 de 2 remitos')).toBeVisible();

		await page.getByLabel('Número de remito').fill('2');
		await bar(page).getByRole('button', { name: 'Buscar' }).click();
		await expect(page).toHaveURL(/[?&]number=2/);
		await expect(rows(page)).toHaveCount(1);

		const from = page.locator('#filter-from');
		await expect(from).toBeHidden();
		await bar(page).locator('summary').click();
		await from.fill(baDay(0));
		await bar(page).getByRole('button', { name: 'Aplicar filtros' }).click();
		await expect(page).toHaveURL(new RegExp(`number=2.*from=${baDay(0)}`));
		await expect(
			page.getByRole('link', { name: /^Quitar el filtro Emitido desde: / })
		).toBeVisible();
		await expect(rows(page)).toHaveCount(1);
		await rows(page).getByRole('link', { name: 'Remito 0002' }).click();
		await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}/deliveries/${noteId}$`));
	});

	for (const name of ['sales', 'settlements', 'deliveries'] as const)
		for (const scheme of ['light', 'dark'] as const)
			test(`phone: ${name}, first row in the first screen, no sideways scroll, 44px targets, axe (${scheme})`, async ({
				browser
			}) => {
				const phone = await browser.newContext({
					baseURL,
					serviceWorkers: 'block',
					viewport: { width: 375, height: 800 },
					isMobile: true,
					hasTouch: true,
					colorScheme: scheme,
					storageState: STATE.admin,
					locale: 'es-AR',
					timezoneId: 'America/Argentina/Buenos_Aires'
				});
				const page = await phone.newPage();
				await open(page, list(name));
				const first = await rows(page).first().boundingBox();
				expect(first, 'the first row is on the page').not.toBeNull();
				expect(first!.y + first!.height, 'the first row is in the first screen').toBeLessThan(800);
				// The row's link is a 44px target, also where it sits inside a sentence.
				const link = await rows(page).first().getByRole('link').boundingBox();
				expect(link!.height, 'the link of a row is 44px tall').toBeGreaterThanOrEqual(44);

				const measured = await page.evaluate(() => {
					const doc = document.scrollingElement!;
					const small = [
						...document.querySelectorAll<HTMLElement>(
							'button, a[href], input:not([type=hidden]), select, textarea, summary'
						)
					]
						.filter((el) => {
							const box = el.getBoundingClientRect();
							// Not displayed (the folded filters), or a link inside running text.
							if (!box.width) return false;
							if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') return false;
							return box.height < 44;
						})
						.map((el) => `${el.tagName} «${(el.textContent ?? '').trim().slice(0, 24)}»`);
					// Nothing scrolls sideways inside the table's own box either: every row fits the screen.
					const box = document.querySelector<HTMLElement>('main table')!.parentElement!;
					return {
						overflow: doc.scrollWidth - window.innerWidth,
						small,
						inner: box.scrollWidth - box.clientWidth
					};
				});
				expect(measured.overflow, 'the page does not scroll sideways').toBeLessThanOrEqual(0);
				expect(measured.inner, 'the table does not scroll sideways').toBeLessThanOrEqual(0);
				expect(measured.small, 'targets under 44px').toEqual([]);
				// The long names are on the rows, wrapped, not cut.
				await expect(
					rows(page)
						.getByText(name === 'sales' ? longBuyer : longCollector, { exact: false })
						.first()
				).toBeVisible();

				const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
				expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
				await phone.close();
			});
});

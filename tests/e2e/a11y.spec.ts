import AxeBuilder from '@axe-core/playwright';
import {
	expect,
	test,
	type Browser,
	type BrowserContext,
	type Locator,
	type Page
} from '@playwright/test';
import {
	baDay,
	createActiveCampaign,
	createBond,
	createCollector,
	createDraftCampaign,
	deliverSellAndSettle,
	open,
	runId
} from './helpers';
import { ANONYMOUS, STATE } from './auth-state';

/**
 * SAN-137 accessibility and mobile pass. Builds one campaign with data on every screen (bond,
 * delivery, sale, payment, closed settlement, frozen-roster draw with a delivered and an unawarded
 * prize), then, per route and per colour scheme (light and dark), one test each for:
 * - desktop (1280px): axe WCAG 2.1 A/AA with no serious or critical violations, and no horizontal
 *   page scroll;
 * - phone (375px): no horizontal page scroll, and interactive controls at least 44px tall (inline
 *   links inside text are exempt, as in WCAG 2.5.8).
 * Plus the winning-number validation result and one open Dialog per area, with axe run while the
 * dialog is open, Esc closing it and focus returning to its trigger.
 */
const SCHEMES = ['light', 'dark'] as const;
type Scheme = (typeof SCHEMES)[number];
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const baseURL = `http://127.0.0.1:${process.env.E2E_PORT ?? 4317}`;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const anon = (route: string) => route.replace(new RegExp(UUID, 'g'), ':id');

type Ids = {
	campaignId: string;
	draftId: string;
	bond: string;
	lostBond: string;
	buyer: string;
	collector: string;
	sale: string;
	note: string;
	settlement: string;
	openSettlement: string;
	payment: string;
	draw: string;
	prize: string;
	unawardedPrize: string;
};
let ids: Ids;
let desktop: BrowserContext;
let phone: BrowserContext;

/** First `/<segment>/<uuid>` link on the page at `path`: ids come from the UI, not the database. */
async function linkedId(page: Page, path: string, segment: string) {
	await open(page, path);
	const hrefs = await page
		.locator(`a[href*="/${segment}/"]`)
		.evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''));
	const re = new RegExp(`/${segment}/(${UUID})(?:[/?#]|$)`);
	const found = hrefs.map((h) => h.match(re)?.[1]).find(Boolean);
	if (!found) throw new Error(`no /${segment}/<id> link on ${path}`);
	return found;
}

async function seed(page: Page): Promise<Ids> {
	const run = runId();
	const draftId = await createDraftCampaign(page, `E2E a11y borrador ${run}`);
	const campaignId = await createActiveCampaign(page, `E2E a11y ${run}`);
	const c = `/campaigns/${campaignId}`;
	await createCollector(page, campaignId, `Cobrador ${run}`);
	await createBond(page, campaignId, 100);
	await createBond(page, campaignId, 200);
	const lostBond = page.url().split('/').pop()!;
	const flow = await deliverSellAndSettle(page, campaignId, `Cobrador ${run}`, 100);
	await open(page, `${c}/settlements/${flow.settlementId}`);
	const paymentHref = await page.locator('a[href*="/payments/"]').first().getAttribute('href');
	const payment = paymentHref?.match(new RegExp(`payments/(${UUID})`))?.[1] ?? '';
	const bond = await linkedId(page, `${c}/sales/${flow.saleId}`, 'bonds');
	const buyer = await linkedId(page, `${c}/sales/${flow.saleId}`, 'buyers');
	const collector = await linkedId(page, `${c}/sales/${flow.saleId}`, 'collectors');

	// A second, still open settlement: its "Cerrar rendición" button opens a Dialog.
	await open(page, `${c}/settlements/new`);
	await page.locator('#collectorId').selectOption({ label: `Cobrador ${run}` });
	await page.getByRole('button', { name: 'Abrir rendición' }).click();
	await expect(page).toHaveURL(new RegExp(`/settlements/${UUID}$`));
	const openSettlement = page.url().split('/').pop()!;

	// A manual ledger adjustment: its "Anular" button opens a Dialog.
	await open(page, `${c}/collectors/${collector}/ledger`);
	await page.locator('#ledger-amount').fill('100');
	await page.locator('#ledger-reason').fill('Ajuste de prueba E2E');
	await page
		.locator('form:has(#ledger-amount)')
		.getByRole('button', { name: 'Registrar ajuste' })
		.click();
	await expect(page.locator('[data-annul]').first()).toBeVisible();

	// Draw with a frozen roster and two prizes: #1 stays pending validation, #2 gets a number that is
	// not in the roster, so it is unawarded straight away.
	await open(page, `${c}/draws/new`);
	await page.locator('#drawType').selectOption('final');
	await page.locator('#name').fill(`Final ${run}`);
	await page.locator('#drawDate').fill(baDay(1));
	await page.locator('#paymentCutoffLocal').fill(`${baDay(0)}T23:59`);
	await page.getByRole('button', { name: 'Crear sorteo' }).click();
	await expect(page).toHaveURL(new RegExp(`/draws/${UUID}$`));
	const draw = page.url().split('/').pop()!;
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: 'Generar padrón' }).click();
	await expect(page.getByText('Padrón generado.')).toBeVisible();
	await page.waitForLoadState('networkidle');
	await page.getByLabel('Confirmo que este padrón es el definitivo').check();
	await page.getByRole('button', { name: 'Congelar padrón' }).click();
	await expect(page.getByText('Padrón congelado.')).toBeVisible();
	await open(page, `${c}/draws/${draw}/winners`);
	for (const [position, name] of [
		['1', 'Bicicleta'],
		['2', 'Televisor']
	]) {
		await page.getByText('Configurar un premio').click();
		await page.locator('#create-position').fill(position);
		await page.locator('#create-name').fill(name);
		await page.getByRole('button', { name: 'Crear premio' }).click();
		await expect(page.getByText('Premio creado.')).toBeVisible();
		await page.waitForLoadState('networkidle');
	}
	const prizeIds = await page
		.locator('input[name="prizeId"]')
		.evaluateAll((els) => [...new Set(els.map((e) => (e as HTMLInputElement).value))]);
	const [prize, unawardedPrize] = prizeIds;
	await page.locator(`#number-${unawardedPrize}`).fill('200');
	await page
		.locator(`form:has(#number-${unawardedPrize})`)
		.getByRole('button', { name: 'Validar contra el padrón congelado' })
		.click();
	await expect(
		page.getByRole('link', { name: 'Imprimir constancia de premio no adjudicado' })
	).toBeVisible();

	const result: Ids = {
		campaignId,
		draftId,
		bond,
		lostBond,
		buyer,
		collector,
		sale: flow.saleId,
		note: flow.noteId,
		settlement: flow.settlementId,
		openSettlement,
		payment,
		draw,
		prize,
		unawardedPrize
	};
	for (const [key, value] of Object.entries(result)) expect(value, `seed id ${key}`).toBeTruthy();
	return result;
}

type Route = { name: string; path: (i: Ids) => string };
const campaign = (i: Ids) => `/campaigns/${i.campaignId}`;
const r = (name: string, path: (i: Ids) => string): Route => ({ name, path });
/** Screens whose content does not depend on the prize workflow stage. */
const ROUTES: Route[] = [
	r('campaigns list', () => '/campaigns'),
	r('campaign new', () => '/campaigns/new'),
	r('campaign detail', campaign),
	r('campaign data and rules', (i) => `${campaign(i)}/configuracion`),
	r('campaign audit', (i) => `${campaign(i)}/audit`),
	r('campaign backups', (i) => `${campaign(i)}/backups`),
	r('bonds list', (i) => `${campaign(i)}/bonds`),
	r('bond detail', (i) => `${campaign(i)}/bonds/${i.bond}`),
	r('bonds import', (i) => `${campaign(i)}/bonds/import`),
	r('bond new', (i) => `${campaign(i)}/bonds/new`),
	r('pata new', (i) => `${campaign(i)}/bonds/pata/new`),
	r('bonds scan', (i) => `${campaign(i)}/bonds/scan`),
	r('buyers list', (i) => `${campaign(i)}/buyers`),
	r('buyer new', (i) => `${campaign(i)}/buyers/new`),
	r('buyer detail', (i) => `${campaign(i)}/buyers/${i.buyer}`),
	r('collectors list', (i) => `${campaign(i)}/collectors`),
	r('collector new', (i) => `${campaign(i)}/collectors/new`),
	r('collector detail', (i) => `${campaign(i)}/collectors/${i.collector}`),
	r('collector ledger', (i) => `${campaign(i)}/collectors/${i.collector}/ledger`),
	r('commissions', (i) => `${campaign(i)}/commissions`),
	r('deliveries list', (i) => `${campaign(i)}/deliveries`),
	r('delivery new', (i) => `${campaign(i)}/deliveries/new`),
	r('delivery detail', (i) => `${campaign(i)}/deliveries/${i.note}`),
	r('delivery print', (i) => `${campaign(i)}/deliveries/${i.note}/print`),
	r('draws list', (i) => `${campaign(i)}/draws`),
	r('draw new', (i) => `${campaign(i)}/draws/new`),
	r('draw detail', (i) => `${campaign(i)}/draws/${i.draw}`),
	r('draw roster', (i) => `${campaign(i)}/draws/${i.draw}/roster`),
	r('winners (pending validation + unawarded)', (i) => `${campaign(i)}/draws/${i.draw}/winners`),
	r(
		'unawarded prize certificate',
		(i) => `${campaign(i)}/draws/${i.draw}/winners/${i.unawardedPrize}/unawarded-certificate`
	),
	r('reports (operational)', (i) => `${campaign(i)}/reports`),
	r('reports (financial)', (i) => `${campaign(i)}/reports/financial`),
	r(
		'reports (financial, collector account and draw roster)',
		(i) => `${campaign(i)}/reports/financial?collector=${i.collector}&draw=${i.draw}`
	),
	r('payment print', (i) => `${campaign(i)}/payments/${i.payment}/print`),
	r('sales list', (i) => `${campaign(i)}/sales`),
	r('sale new', (i) => `${campaign(i)}/sales/new`),
	r('sale detail', (i) => `${campaign(i)}/sales/${i.sale}`),
	r('settlements list', (i) => `${campaign(i)}/settlements`),
	r('settlement new', (i) => `${campaign(i)}/settlements/new`),
	r('settlement detail (closed)', (i) => `${campaign(i)}/settlements/${i.settlement}`),
	r('settlement print', (i) => `${campaign(i)}/settlements/${i.settlement}/print`)
];
/** Screens that exist only once prize #1 is delivered (declared after the delivery test). */
const DELIVERED_ROUTES: Route[] = [
	r('winners (delivered)', (i) => `${campaign(i)}/draws/${i.draw}/winners`),
	r(
		'prize delivery certificate',
		(i) => `${campaign(i)}/draws/${i.draw}/winners/${i.prize}/delivery-certificate`
	)
];

type Metrics = { overflow: number; tiny: string[] };
/** Horizontal overflow, and (with `taps`) interactive controls under 44px. */
async function measure(page: Page, taps: boolean): Promise<Metrics> {
	return page.evaluate((checkTaps) => {
		const doc = document.scrollingElement!;
		const overflow = doc.scrollWidth - window.innerWidth;
		if (!checkTaps) return { overflow, tiny: [] };
		const tiny = [
			...document.querySelectorAll<HTMLElement>(
				'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button]'
			)
		]
			.filter((el) => {
				if (!el.getBoundingClientRect().width) return false;
				// Links inside running text are exempt (WCAG 2.5.8 inline exception).
				if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') return false;
				// A checkbox or radio is tapped through its label.
				const input = el as HTMLInputElement;
				const label =
					(input.type === 'checkbox' || input.type === 'radio') &&
					(el.closest('label') ??
						(el.id ? document.querySelector<HTMLElement>(`label[for="${el.id}"]`) : null));
				const box = (label || el).getBoundingClientRect();
				return box.height < 44;
			})
			.slice(0, 4)
			.map(
				(el) =>
					`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} "${(el.textContent ?? '').trim().slice(0, 24)}" ${Math.round(el.getBoundingClientRect().height)}px`
			);
		return { overflow, tiny };
	}, taps);
}

/** Runs axe; fails on serious/critical violations and records the moderate ones as annotations. */
async function expectNoSeriousViolations(page: Page, label: string) {
	const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
	const describe = (v: (typeof result.violations)[number]) =>
		`${v.id} (${v.impact}): ${v.help} -> ${v.nodes
			.slice(0, 3)
			.map((n) => n.target.join(' '))
			.join(' | ')}`;
	for (const v of result.violations.filter((v) => v.impact === 'moderate'))
		test.info().annotations.push({ type: 'axe-moderate', description: `${label}: ${describe(v)}` });
	expect(
		result.violations
			.filter((v) => v.impact === 'serious' || v.impact === 'critical')
			.map(describe),
		`${label}: axe serious/critical violations`
	).toEqual([]);
}

async function inPage(ctx: BrowserContext, scheme: Scheme, fn: (page: Page) => Promise<void>) {
	const page = await ctx.newPage();
	try {
		await page.emulateMedia({ colorScheme: scheme });
		await fn(page);
	} finally {
		await page.close();
	}
}

function newContext(browser: Browser, state: string, phoneSize: boolean) {
	return browser.newContext({
		baseURL,
		serviceWorkers: 'block',
		viewport: phoneSize ? { width: 375, height: 800 } : { width: 1280, height: 800 },
		isMobile: phoneSize,
		hasTouch: phoneSize,
		storageState: state,
		locale: 'es-AR',
		timezoneId: 'America/Argentina/Buenos_Aires'
	});
}

/** Axe + 1280px overflow, and the 375px checks, for each route in each scheme. */
function routeTests(routes: Route[]) {
	for (const route of routes)
		for (const scheme of SCHEMES) {
			test(`axe and 1280px: ${route.name} [${scheme}]`, async () => {
				test.setTimeout(60_000);
				await inPage(desktop, scheme, async (page) => {
					const path = route.path(ids);
					await open(page, path);
					const label = `${route.name} ${anon(path)} [${scheme}]`;
					await expectNoSeriousViolations(page, label);
					const { overflow } = await measure(page, false);
					expect(overflow, `${label}: horizontal scroll at 1280px`).toBeLessThanOrEqual(1);
				});
			});
			test(`375px: ${route.name} [${scheme}]`, async () => {
				test.setTimeout(60_000);
				await inPage(phone, scheme, async (page) => {
					const path = route.path(ids);
					await open(page, path);
					const label = `${route.name} ${anon(path)} [${scheme}]`;
					const { overflow, tiny } = await measure(page, true);
					expect(overflow, `${label}: horizontal scroll at 375px`).toBeLessThanOrEqual(1);
					expect(tiny, `${label}: targets under 44px at 375px`).toEqual([]);
				});
			});
		}
}

type DialogCase = { area: string; path: (i: Ids) => string; trigger: (page: Page) => Locator };
// One open Dialog per area. axe runs while it is open; Esc closes it and focus returns to the
// button that opened it (native <dialog> behaviour, asserted so a regression is caught).
const DIALOGS: DialogCase[] = [
	{
		area: 'campaigns: activate a draft',
		path: (i) => `/campaigns/${i.draftId}`,
		trigger: (p) => p.getByRole('button', { name: 'Activar', exact: true })
	},
	{
		area: 'bonds: mark as lost',
		path: (i) => `${campaign(i)}/bonds/${i.lostBond}`,
		trigger: (p) => p.getByRole('button', { name: 'Marcar como extraviado' })
	},
	{
		area: 'settlements: close an open settlement',
		path: (i) => `${campaign(i)}/settlements/${i.openSettlement}`,
		trigger: (p) => p.getByRole('button', { name: 'Cerrar rendición' }).first()
	},
	{
		area: 'collectors: annul a ledger entry',
		path: (i) => `${campaign(i)}/collectors/${i.collector}/ledger`,
		trigger: (p) => p.locator('[data-annul]').first()
	}
];

test.describe.serial('a11y and mobile pass', () => {
	test.beforeAll(async ({ browser }) => {
		test.setTimeout(300_000);
		const seedCtx = await browser.newContext({
			baseURL,
			serviceWorkers: 'block',
			storageState: STATE.admin,
			locale: 'es-AR',
			timezoneId: 'America/Argentina/Buenos_Aires'
		});
		const page = await seedCtx.newPage();
		ids = await seed(page);
		await seedCtx.close();
		desktop = await newContext(browser, STATE.admin, false);
		phone = await newContext(browser, STATE.admin, true);
	});
	test.afterAll(async () => {
		await desktop?.close();
		await phone?.close();
	});

	routeTests(ROUTES);

	for (const scheme of SCHEMES)
		test(`winning-number validation result [${scheme}]`, async () => {
			test.setTimeout(90_000);
			// Prize #1 is still pending validation: load number 100 (the sold, paid bond); the result
			// panel is shown right after the action. The second scheme finds the number already loaded
			// and audits the persisted result instead.
			await inPage(desktop, scheme, async (page) => {
				await open(page, `${campaign(ids)}/draws/${ids.draw}/winners`);
				const loadForm = page.locator(`form:has(#number-${ids.prize})`);
				if (await loadForm.count()) {
					await page.locator(`#number-${ids.prize}`).fill('100');
					await loadForm
						.getByRole('button', { name: 'Validar contra el padrón congelado' })
						.click();
					await expect(
						page.getByText('Resultado de la validación del 0100'),
						'validation result panel after loading winning number 100'
					).toBeVisible();
				}
				await expect(page.getByText('Pendiente de resolución.').first()).toBeVisible();
				await expectNoSeriousViolations(page, `winning-number validation result [${scheme}]`);
				const { overflow } = await measure(page, false);
				expect(overflow, 'validation result: horizontal scroll at 1280px').toBeLessThanOrEqual(1);
			});
		});

	test('prize #1 is awarded and delivered', async () => {
		test.setTimeout(90_000);
		const page = await desktop.newPage();
		try {
			await open(page, `${campaign(ids)}/draws/${ids.draw}/winners`);
			await page.getByRole('button', { name: 'Registrar resolución' }).click();
			await expect(page.getByText('Premio resuelto.')).toBeVisible();
			await page.waitForLoadState('networkidle');
			await page.locator(`#delivery-notes-${ids.prize}`).fill('Entregado en el cuartel');
			await page.getByRole('button', { name: 'Registrar entrega' }).click();
			await expect(
				page.getByRole('link', { name: 'Imprimir constancia de entrega' })
			).toBeVisible();
		} finally {
			await page.close();
		}
	});

	routeTests(DELIVERED_ROUTES);

	for (const d of DIALOGS)
		for (const scheme of SCHEMES)
			test(`dialog ${d.area} [${scheme}]`, async () => {
				test.setTimeout(60_000);
				await inPage(desktop, scheme, async (page) => {
					await open(page, d.path(ids));
					const trigger = d.trigger(page);
					await trigger.click();
					const dialog = page.getByRole('dialog');
					await expect(dialog, `${d.area}: dialog opens`).toBeVisible();
					await expectNoSeriousViolations(page, `dialog ${d.area} [${scheme}] (open)`);
					await page.keyboard.press('Escape');
					await expect(dialog, `${d.area}: Esc closes the dialog`).toBeHidden();
					await expect(trigger, `${d.area}: focus returns to the trigger`).toBeFocused();
				});
			});
});

test.describe('login page', () => {
	test.use({ storageState: ANONYMOUS });
	test('the login page passes axe in light and dark', async ({ page }) => {
		for (const scheme of SCHEMES) {
			await page.emulateMedia({ colorScheme: scheme });
			await open(page, '/login');
			await expectNoSeriousViolations(page, `login [${scheme}]`);
		}
	});
});

/** Keyboard-only: Tab reaches the page's controls and every focused element shows a focus ring. */
test('keyboard focus is always visible on the main screens', async ({ page }) => {
	const campaignId = await createActiveCampaign(page, `E2E teclado ${runId()}`);
	const c = `/campaigns/${campaignId}`;
	const problems: string[] = [];
	for (const route of [
		'/campaigns',
		c,
		`${c}/bonds`,
		`${c}/sales/new`,
		`${c}/settlements/new`,
		`${c}/draws/new`
	]) {
		await open(page, route);
		await page.locator('body').click({ position: { x: 1, y: 1 } });
		let stops = 0;
		for (let i = 0; i < 25; i++) {
			await page.keyboard.press('Tab');
			const state = await page.evaluate(() => {
				const el = document.activeElement as HTMLElement | null;
				if (!el || el === document.body) return null;
				const style = getComputedStyle(el);
				const ring =
					(style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) ||
					style.boxShadow !== 'none';
				return {
					ring,
					name: `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 30)}"`
				};
			});
			if (!state) break;
			stops++;
			if (!state.ring) problems.push(`${anon(route)}: ${state.name}`);
		}
		// The header, breadcrumbs and the screen's own controls are all reachable.
		expect(stops, route).toBeGreaterThanOrEqual(5);
	}
	expect(problems).toEqual([]);
});

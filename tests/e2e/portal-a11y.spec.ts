import AxeBuilder from '@axe-core/playwright';
import { createClient } from '@supabase/supabase-js';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
	apiActiveCampaign,
	apiBond,
	apiCollector,
	apiDeliverAndSell,
	localSupabase,
	serviceClient
} from './api';
import { login, open, runId } from './helpers';
import { ANONYMOUS } from './auth-state';
import { SCHEMES, runCell, type Scheme } from './matrix';

/**
 * SAN-148 accessibility pass of the collector portal (same method as SAN-137, `a11y.spec.ts`). A collector
 * login is linked to a collector with one delivered and sold bond and one submitted collection; then, for
 * every portal route in light and dark: axe WCAG 2.1 A/AA with no serious or critical violations and no
 * horizontal scroll at 1280px; at 375px no horizontal scroll and 44px targets. Plus keyboard navigation
 * through the portal sub-navigation, which also proves "Mi cuenta corriente" is linked.
 *
 * Needs the local Supabase stack (service role key from the environment or `supabase status`), like the
 * other E2E specs. It refuses to run against anything that is not local.
 */
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const baseURL = `http://127.0.0.1:${process.env.E2E_PORT ?? 4317}`;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const anon = (route: string) => route.replace(new RegExp(UUID, 'g'), ':id');
const PASSWORD = 'PortalA11y123!';

type Ids = { campaignId: string; bond: string; sale: string; buyer: string; note: string };
let ids: Ids;
let desktop: BrowserContext;
let phone: BrowserContext;

async function seed(browser: Browser) {
	const run = runId();
	// The admin's part goes through the API: this spec checks the portal screens, not the staff flows.
	const campaignId = await apiActiveCampaign(`E2E portal ${run}`);
	const collectorId = await apiCollector(`Cobrador portal ${run}`);
	const bond = await apiBond(campaignId, 300);
	const {
		saleId,
		noteId: note,
		buyerId: buyer
	} = await apiDeliverAndSell(campaignId, collectorId, bond);

	// A collector login linked to that collector (no admin UI creates logins, so it goes through Supabase).
	const { url, anonKey } = localSupabase();
	const options = { auth: { autoRefreshToken: false, persistSession: false } };
	const service = serviceClient();
	const email = `portal_e2e_${run}@firefighters.local`;
	const created = await service.auth.admin.createUser({
		email,
		password: PASSWORD,
		email_confirm: true,
		user_metadata: { full_name: `Portal E2E ${run}` }
	});
	if (created.error || !created.data.user) throw new Error(created.error?.message);
	const provisioned = await service.rpc('admin_provision_profile', {
		p_auth_user_id: created.data.user.id,
		p_full_name: `Portal E2E ${run}`,
		p_role_names: ['collector'],
		p_actor_profile_id: null,
		p_request_id: `e2e-portal-${run}`,
		p_reason: null
	});
	if (provisioned.error) throw new Error(provisioned.error.message);
	const profileId = (provisioned.data as { id?: string } | string)?.valueOf();
	const { data: profile } = await service
		.from('profiles')
		.select('id')
		.eq('auth_user_id', created.data.user.id)
		.single();
	const linked = await service
		.from('collectors')
		.update({ user_profile_id: profile?.id ?? profileId })
		.eq('id', collectorId);
	if (linked.error) throw new Error(linked.error.message);

	// One collection submitted by the collector, so the sale page shows "Cobros enviados".
	const client = createClient(url, anonKey, options);
	const signed = await client.auth.signInWithPassword({ email, password: PASSWORD });
	if (signed.error) throw new Error(signed.error.message);
	const { data: plan } = await service
		.from('payment_plans')
		.select('id')
		.eq('sale_id', saleId)
		.single();
	const { data: installment } = await service
		.from('installments')
		.select('id')
		.eq('payment_plan_id', plan!.id)
		.limit(1)
		.single();
	const today = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'America/Argentina/Buenos_Aires'
	}).format(new Date());
	const submitted = await client.rpc('portal_payment_submit', {
		p_sale_id: saleId,
		p_amount: 100,
		p_payment_method: 'cash',
		p_payment_date: today,
		p_applications: [{ installment_id: installment!.id, amount_applied: 100 }],
		p_request_id: `e2e-portal-pay-${run}`,
		p_note: 'Cobrado en mano'
	});
	if (submitted.error) throw new Error(submitted.error.message);

	// Sign in the browser as the collector and keep that session for the contexts below.
	const ctx = await browser.newContext({
		baseURL,
		serviceWorkers: 'block',
		// Not the default admin session: this context signs in as the new collector.
		storageState: ANONYMOUS,
		locale: 'es-AR',
		timezoneId: 'America/Argentina/Buenos_Aires'
	});
	const collectorPage = await ctx.newPage();
	await login(collectorPage, { email, password: PASSWORD });
	const state = await ctx.storageState();
	await ctx.close();
	return { ids: { campaignId, bond, sale: saleId, buyer, note } satisfies Ids, state };
}

type Route = { name: string; path: (i: Ids) => string };
const r = (name: string, path: (i: Ids) => string): Route => ({ name, path });
const portal = (i: Ids) => `/portal/${i.campaignId}`;
/**
 * Core routes get the whole matrix in the default run, the rest only light + desktop (see matrix.ts):
 * a list, a detail, the screen with the payment form and the account ledger.
 */
const CORE = new Set([
	'mis bonos',
	'detalle de venta con formulario de cobro',
	'mi cuenta corriente'
]);
const ROUTES: Route[] = [
	r('landing', () => '/portal'),
	r('mis bonos', (i) => `${portal(i)}/bonos`),
	r('detalle de bono', (i) => `${portal(i)}/bonos/${i.bond}`),
	r('mis ventas', (i) => `${portal(i)}/ventas`),
	r('detalle de venta con formulario de cobro', (i) => `${portal(i)}/ventas/${i.sale}`),
	r('mis compradores', (i) => `${portal(i)}/compradores`),
	r('detalle de comprador', (i) => `${portal(i)}/compradores/${i.buyer}`),
	r('por cobrar', (i) => `${portal(i)}/por-cobrar`),
	r('mi cuenta corriente', (i) => `${portal(i)}/cuenta`)
];

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

async function measure(page: Page, taps: boolean) {
	return page.evaluate((checkTaps) => {
		const overflow = document.scrollingElement!.scrollWidth - window.innerWidth;
		if (!checkTaps) return { overflow, tiny: [] as string[] };
		const tiny = [
			...document.querySelectorAll<HTMLElement>(
				'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button]'
			)
		]
			.filter((el) => {
				if (!el.getBoundingClientRect().width) return false;
				if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') return false;
				const input = el as HTMLInputElement;
				const label =
					(input.type === 'checkbox' || input.type === 'radio') &&
					(el.closest('label') ??
						(el.id ? document.querySelector<HTMLElement>(`label[for="${el.id}"]`) : null));
				return (label || el).getBoundingClientRect().height < 44;
			})
			.slice(0, 4)
			.map(
				(el) =>
					`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} "${(el.textContent ?? '').trim().slice(0, 24)}"`
			);
		return { overflow, tiny };
	}, taps);
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

const newContext = (
	browser: Browser,
	state: Awaited<ReturnType<BrowserContext['storageState']>>,
	phoneSize: boolean
) =>
	browser.newContext({
		baseURL,
		serviceWorkers: 'block',
		viewport: phoneSize ? { width: 375, height: 800 } : { width: 1280, height: 800 },
		isMobile: phoneSize,
		hasTouch: phoneSize,
		storageState: state,
		locale: 'es-AR',
		timezoneId: 'America/Argentina/Buenos_Aires'
	});

test.describe.serial('portal del cobrador: a11y and mobile pass', () => {
	test.beforeAll(async ({ browser }) => {
		test.setTimeout(300_000);
		const seeded = await seed(browser);
		ids = seeded.ids;
		desktop = await newContext(browser, seeded.state, false);
		phone = await newContext(browser, seeded.state, true);
	});
	test.afterAll(async () => {
		await desktop?.close();
		await phone?.close();
	});

	for (const route of ROUTES)
		for (const scheme of SCHEMES) {
			const core = CORE.has(route.name);
			if (runCell(core, scheme, false))
				test(`axe and 1280px: ${route.name} [${scheme}]`, async () => {
					test.setTimeout(60_000);
					await inPage(desktop, scheme, async (page) => {
						const path = route.path(ids);
						await open(page, path);
						const label = `${route.name} ${anon(path)} [${scheme}]`;
						await expect(page.locator('main h1').first()).toBeVisible();
						await expectNoSeriousViolations(page, label);
						expect(
							(await measure(page, false)).overflow,
							`${label}: scroll at 1280px`
						).toBeLessThanOrEqual(1);
					});
				});
			if (runCell(core, scheme, true))
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

	test('the sub-navigation is reachable by keyboard and links every section', async () => {
		test.setTimeout(60_000);
		await inPage(desktop, 'light', async (page) => {
			await open(page, `/portal/${ids.campaignId}/bonos`);
			const nav = page.getByRole('navigation', { name: /Portal del cobrador/ });
			// UX plan PR 10: «Por cobrar» first, in the order of the collector's day.
			const names = [
				'Por cobrar',
				'Mis bonos',
				'Mis ventas',
				'Mis compradores',
				'Mi cuenta corriente'
			];
			for (const name of names) await expect(nav.getByRole('link', { name })).toBeVisible();
			expect(await nav.getByRole('link').allInnerTexts()).toEqual(names);
			await expect(nav.getByRole('link', { name: 'Mis bonos' })).toHaveAttribute(
				'aria-current',
				'page'
			);
			// Tab to "Mi cuenta corriente" and open it with Enter.
			await nav.getByRole('link', { name: 'Mis bonos' }).focus();
			for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
			await expect(nav.getByRole('link', { name: 'Mi cuenta corriente' })).toBeFocused();
			await page.keyboard.press('Enter');
			await expect(page).toHaveURL(new RegExp(`/portal/${ids.campaignId}/cuenta$`));
			await expect(nav.getByRole('link', { name: 'Mi cuenta corriente' })).toHaveAttribute(
				'aria-current',
				'page'
			);
		});
	});

	test('the own delivery note prints from the bond page and passes axe (SAN-153)', async () => {
		test.setTimeout(60_000);
		await inPage(desktop, 'light', async (page) => {
			await open(page, `/portal/${ids.campaignId}/bonos/${ids.bond}`);
			await page.getByRole('link', { name: 'Ver remito' }).first().click();
			await expect(page).toHaveURL(
				new RegExp(`/portal/${ids.campaignId}/remitos/${ids.note}/imprimir$`)
			);
			await expect(
				page.getByRole('heading', { name: 'Remito de entrega de bonos' }).first()
			).toBeVisible();
			await expectNoSeriousViolations(page, 'remito imprimible');
		});
		await inPage(phone, 'light', async (page) => {
			await open(page, `/portal/${ids.campaignId}/remitos/${ids.note}/imprimir`);
			expect((await measure(page, false)).overflow).toBeLessThanOrEqual(1);
		});
	});

	test('the sale page lists the submitted collection as pending', async () => {
		test.setTimeout(60_000);
		await inPage(desktop, 'light', async (page) => {
			await open(page, `/portal/${ids.campaignId}/ventas/${ids.sale}`);
			await expect(page.getByText('Pendiente de rendición').first()).toBeVisible();
		});
	});

	test('no table scrolls sideways on a phone: every list is stacked rows (UX plan PR 11)', async () => {
		test.setTimeout(120_000);
		await inPage(phone, 'light', async (page) => {
			for (const route of ROUTES) {
				await open(page, route.path(ids));
				const scrolling = await page.evaluate(() =>
					[...document.querySelectorAll<HTMLElement>('main *')]
						.filter(
							(el) =>
								el.clientWidth > 1 &&
								// A region that scrolls: clipped text (ellipsis, visually hidden labels) is not one.
								['auto', 'scroll'].includes(getComputedStyle(el).overflowX) &&
								el.scrollWidth > el.clientWidth + 1
						)
						.map((el) => `${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 40)}`)
				);
				expect(scrolling, `${route.name}: something scrolls sideways at 375px`).toEqual([]);
			}
		});
	});

	test('the landing goes straight to what there is to collect (P5)', async () => {
		test.setTimeout(60_000);
		await inPage(phone, 'light', async (page) => {
			await open(page, '/portal');
			// With one campaign in course the landing redirects (asserted in page.server.test.ts). In a
			// full run other specs leave their own active campaigns in this database, and then the
			// landing lists them: either way the way in is «Por cobrar», never «Mis bonos».
			if (!/\/por-cobrar$/.test(new URL(page.url()).pathname)) {
				await expect(page.getByRole('heading', { name: 'Elegir la campaña' })).toBeVisible();
				await expect(page.locator('main a[href$="/bonos"]')).toHaveCount(0);
				await page.locator(`main a[href="/portal/${ids.campaignId}/por-cobrar"]`).click();
			}
			await expect(page).toHaveURL(new RegExp(`/portal/${ids.campaignId}/por-cobrar$`));
			await expect(page.getByRole('heading', { name: 'Por cobrar', level: 1 })).toBeVisible();
			// On a phone the five sections are a bar at the bottom, with «Por cobrar» current.
			const tabs = page.locator('[data-portal-tabs]');
			await expect(tabs.getByRole('link')).toHaveCount(5);
			await expect(tabs.getByRole('link', { name: 'Por cobrar' })).toHaveAttribute(
				'aria-current',
				'page'
			);
			const bar = await tabs.boundingBox();
			expect(bar!.y + bar!.height, 'the bar is at the bottom of the screen').toBeGreaterThan(780);
		});
	});

	test('a collection is sent from the list: «Cobrar», the sheet, «Enviar», and it stays as «Enviado»', async () => {
		test.setTimeout(90_000);
		await inPage(phone, 'light', async (page) => {
			await open(page, `/portal/${ids.campaignId}/por-cobrar`);
			const row = page.locator('[data-due-row]').first();
			await expect(row).toContainText('0300');
			// The collection seeded above ($ 100) is on the row; what is left can still be sent.
			await expect(row).toContainText(/Enviado \$\s100/);
			await row.getByRole('button', { name: /^Cobrar/ }).tap();
			const sheet = page.getByRole('dialog');
			await expect(sheet).toContainText('Cobrar la cuota 1 del bono 0300');
			await expect(sheet.getByLabel('Importe')).toHaveValue('900,00');
			await expect(sheet.getByRole('radio', { name: 'Efectivo' })).toBeChecked();
			await expectNoSeriousViolations(page, 'hoja Cobrar (abierta)');
			// More than what is left cannot be sent.
			await sheet.getByLabel('Importe').fill('950');
			await expect(sheet.getByText(/El importe no puede superar/)).toBeVisible();
			await expect(sheet.getByRole('button', { name: /^Enviar cobro/ })).toBeDisabled();
			await sheet.getByLabel('Importe').fill('900,00');
			await sheet.getByRole('button', { name: /^Enviar cobro de \$\s900$/ }).tap();
			// Third screen: the sale, saying the collection was sent.
			await expect(page).toHaveURL(
				new RegExp(`/portal/${ids.campaignId}/ventas/${ids.sale}\\?enviado=1$`)
			);
			await expect(page.getByText('Cobro enviado')).toBeVisible();

			// Back on the list the installment is still there, as sent, with nothing left to collect.
			await open(page, `/portal/${ids.campaignId}/por-cobrar`);
			const sent = page.locator('[data-due-row]').first();
			await expect(sent).toContainText(/Enviado \$\s1\.000/);
			await expect(sent.getByRole('button', { name: /^Cobrar/ })).toHaveCount(0);
		});
	});
});

import AxeBuilder from '@axe-core/playwright';
import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import {
	baDay,
	createActiveCampaign,
	createBond,
	createCollector,
	deliverSellAndSettle,
	login,
	open,
	runId
} from './helpers';

/**
 * SAN-137 accessibility and mobile pass. Builds one campaign with data on every screen (bond,
 * delivery, sale, payment, closed settlement, frozen-roster draw with an awarded prize), then:
 * - axe (WCAG 2.1 A/AA) on every route in light and dark: no serious or critical violations;
 * - at 375px: no horizontal page scroll, and interactive controls are at least 44px tall or wide
 *   enough to tap (inline links inside text are exempt, as in WCAG 2.5.8).
 */
const db = () =>
	createClient(
		process.env.PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
		process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
		{
			auth: { persistSession: false }
		}
	);

async function seed(page: Page) {
	const run = runId();
	await login(page);
	const campaignId = await createActiveCampaign(page, `E2E a11y ${run}`);
	await createCollector(page, campaignId, `Cobrador ${run}`);
	await createBond(page, campaignId, 100);
	await createBond(page, campaignId, 200);
	const flow = await deliverSellAndSettle(page, campaignId, `Cobrador ${run}`, 100);
	await open(page, `/campaigns/${campaignId}/settlements/${flow.settlementId}`);
	const paymentHref = await page.locator('a[href*="/payments/"]').first().getAttribute('href');
	const paymentId = paymentHref?.match(/payments\/([0-9a-f-]{36})/)?.[1];
	await open(page, `/campaigns/${campaignId}/draws/new`);
	await page.locator('#drawType').selectOption('final');
	await page.locator('#name').fill(`Final ${run}`);
	await page.locator('#drawDate').fill(baDay(1));
	await page.locator('#paymentCutoffLocal').fill(`${baDay(0)}T23:59`);
	await page.getByRole('button', { name: 'Crear sorteo' }).click();
	await expect(page).toHaveURL(/\/draws\/[0-9a-f-]{36}$/);
	const drawId = page.url().split('/').pop()!;
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: 'Generar padrón' }).click();
	await expect(page.getByText('Padrón generado.')).toBeVisible();
	await page.waitForLoadState('networkidle');
	await page.getByLabel('Confirmo que este padrón es el definitivo').check();
	await page.getByRole('button', { name: 'Congelar padrón' }).click();
	await expect(page.getByText('Padrón congelado.')).toBeVisible();
	await open(page, `/campaigns/${campaignId}/draws/${drawId}/winners`);
	await page.getByText('Configurar un premio').click();
	await page.locator('#create-position').fill('1');
	await page.locator('#create-name').fill('Bicicleta');
	await page.getByRole('button', { name: 'Crear premio' }).click();
	await expect(page.getByText('Premio creado.')).toBeVisible();

	const c = `/campaigns/${campaignId}`;
	const { data: sale, error } = await db()
		.from('sales')
		.select('id, collector_id, buyer_id, bond_id')
		.eq('campaign_id', campaignId)
		.single();
	if (error) throw error;
	const ids = {
		collector: sale.collector_id as string,
		buyer: sale.buyer_id as string,
		bond: sale.bond_id as string,
		sale: sale.id as string,
		note: flow.noteId,
		settlement: flow.settlementId,
		payment: paymentId
	};
	const routes = [
		'/campaigns',
		'/campaigns/new',
		c,
		`${c}/audit`,
		`${c}/backups`,
		`${c}/bonds`,
		`${c}/bonds/${ids.bond}`,
		`${c}/bonds/import`,
		`${c}/bonds/new`,
		`${c}/bonds/pata/new`,
		`${c}/bonds/scan`,
		`${c}/buyers`,
		`${c}/buyers/new`,
		`${c}/buyers/${ids.buyer}`,
		`${c}/collectors`,
		`${c}/collectors/new`,
		`${c}/collectors/${ids.collector}`,
		`${c}/collectors/${ids.collector}/ledger`,
		`${c}/commissions`,
		`${c}/deliveries`,
		`${c}/deliveries/new`,
		`${c}/deliveries/${ids.note}`,
		`${c}/deliveries/${ids.note}/print`,
		`${c}/draws`,
		`${c}/draws/new`,
		`${c}/draws/${drawId}`,
		`${c}/draws/${drawId}/roster`,
		`${c}/draws/${drawId}/winners`,
		`${c}/payments/${ids.payment}/print`,
		`${c}/sales`,
		`${c}/sales/new`,
		`${c}/sales/${ids.sale}`,
		`${c}/settlements`,
		`${c}/settlements/new`,
		`${c}/settlements/${ids.settlement}`,
		`${c}/settlements/${ids.settlement}/print`
	];
	for (const [key, value] of Object.entries(ids)) expect(value, key).toBeTruthy();
	return { campaignId, routes };
}

type Finding = {
	route: string;
	scheme: string;
	id: string;
	impact: string;
	help: string;
	targets: string[];
};

test('every route passes axe (light and dark) and the 375px checks', async ({ page, browser }) => {
	test.setTimeout(600_000);
	const { routes } = await seed(page);
	const findings: Finding[] = [];
	const mobile: string[] = [];

	for (const scheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: scheme });
		for (const route of routes) {
			await open(page, route);
			const result = await new AxeBuilder({ page })
				.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
				.analyze();
			for (const v of result.violations)
				if (v.impact === 'serious' || v.impact === 'critical')
					findings.push({
						route: route.replace(/[0-9a-f-]{36}/g, ':id'),
						scheme,
						id: v.id,
						impact: v.impact,
						help: v.help,
						targets: v.nodes.slice(0, 3).map((n) => n.target.join(' '))
					});
		}
	}

	const phone = await browser.newContext({
		viewport: { width: 375, height: 800 },
		isMobile: true,
		hasTouch: true,
		storageState: await page.context().storageState(),
		locale: 'es-AR',
		timezoneId: 'America/Argentina/Buenos_Aires'
	});
	const small = await phone.newPage();
	for (const route of routes) {
		await open(small, route);
		const report = await small.evaluate(() => {
			const doc = document.scrollingElement!;
			const overflow = doc.scrollWidth - window.innerWidth;
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
		});
		const name = route.replace(/[0-9a-f-]{36}/g, ':id');
		if (report.overflow > 1) mobile.push(`${name}: horizontal scroll of ${report.overflow}px`);
		if (report.tiny.length) mobile.push(`${name}: targets under 44px: ${report.tiny.join('; ')}`);
	}
	await phone.close();

	console.log('AXE', JSON.stringify(findings, null, 1));
	console.log('MOBILE', JSON.stringify(mobile, null, 1));
	expect(findings).toEqual([]);
	expect(mobile).toEqual([]);
});

test('the login page passes axe in light and dark', async ({ page }) => {
	for (const scheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: scheme });
		await open(page, '/login');
		const result = await new AxeBuilder({ page })
			.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
			.analyze();
		const serious = result.violations.filter(
			(v) => v.impact === 'serious' || v.impact === 'critical'
		);
		expect(serious.map((v) => `${scheme}: ${v.id}`)).toEqual([]);
	}
});

/** Keyboard-only: Tab reaches the page's controls and every focused element shows a focus ring. */
test('keyboard focus is always visible on the main screens', async ({ page }) => {
	await login(page);
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
			if (!state.ring) problems.push(`${route.replace(/[0-9a-f-]{36}/g, ':id')}: ${state.name}`);
		}
		// The header, breadcrumbs and the screen's own controls are all reachable.
		expect(stops, route).toBeGreaterThanOrEqual(5);
	}
	expect(problems).toEqual([]);
});

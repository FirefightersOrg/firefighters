import { expect, test, type Browser, type BrowserContext } from '@playwright/test';
import {
	findDemoIds,
	portalScreens,
	signedInClient,
	staffScreens,
	type Screen
} from '../../scripts/demo-screens';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import { seedDemo } from '../../scripts/seed-demo';
import { STATE } from './auth-state';
import { open } from './helpers';

/**
 * Realistic-data sweep (UX plan, PR 1). The a11y sweep builds a campaign with two bonds and
 * four-digit amounts, so problems that only show with real volumes and real amounts pass it: the UX
 * audit found pages that scroll sideways at 375 px with 240 bonds and seven-digit amounts.
 *
 * This spec loads the demo campaign (`scripts/seed-demo.ts`: 240 bonds, 147 sales, 15 settlements)
 * and opens every staff screen as the admin and every portal screen as the linked collector, at
 * 375 px in light, checking that the page does not scroll sideways.
 *
 * Screens that overflow today are listed in KNOWN_OVERFLOW with the audit item and the plan PR that
 * fixes them. The list only shrinks: a listed screen that stops overflowing fails the sweep until
 * its entry is removed, and a screen that is not listed fails as soon as it overflows.
 */
const KNOWN_OVERFLOW: Record<string, string> = {
	'44-settlement-print': 'audit A7, the note is wider than the phone (plan PR 18)',
	'81-reports-financial': 'audit A7, the export buttons do not wrap (plan PR 17)',
	'82-reports-financial-collector': 'audit A7, the export buttons do not wrap (plan PR 17)'
};

const baseURL = `http://127.0.0.1:${process.env.E2E_PORT ?? 4317}`;
/** Sub-pixel rounding, as in the a11y sweep. */
const TOLERANCE = 1;

let staff: Screen[];
let portal: Screen[];
let adminPhone: BrowserContext;
let collectorPhone: BrowserContext;

function phone(browser: Browser, storageState: string) {
	return browser.newContext({
		baseURL,
		serviceWorkers: 'block',
		locale: 'es-AR',
		timezoneId: 'America/Argentina/Buenos_Aires',
		viewport: { width: 375, height: 812 },
		hasTouch: true,
		colorScheme: 'light',
		storageState
	});
}

/** Opens each screen and checks its horizontal overflow against the known list. */
async function sweep(context: BrowserContext, screens: Screen[]) {
	const page = await context.newPage();
	for (const screen of screens) {
		await open(page, screen.path);
		const overflow = await page.evaluate(
			() => document.scrollingElement!.scrollWidth - window.innerWidth
		);
		const known = KNOWN_OVERFLOW[screen.slug];
		if (known) {
			expect
				.soft(
					overflow,
					`${screen.slug} no longer scrolls sideways at 375 px: remove it from KNOWN_OVERFLOW (${known})`
				)
				.toBeGreaterThan(TOLERANCE);
		} else {
			expect
				.soft(overflow, `${screen.slug} scrolls sideways at 375 px with realistic data`)
				.toBeLessThanOrEqual(TOLERANCE);
		}
	}
	await page.close();
}

test.describe.serial('realistic data at 375 px', () => {
	test.beforeAll(async ({ browser }) => {
		test.setTimeout(240_000);
		const config = resolveSeedConfig();
		const anonKey = process.env.PUBLIC_SUPABASE_ANON_KEY?.trim();
		if (!anonKey) throw new Error('PUBLIC_SUPABASE_ANON_KEY is required for the demo campaign.');

		await seedDemo();
		const ids = await findDemoIds(await signedInClient(config.supabaseUrl, anonKey, config.admin));
		staff = staffScreens(ids);
		portal = portalScreens(ids);
		adminPhone = await phone(browser, STATE.admin);
		collectorPhone = await phone(browser, STATE.collector);
	});

	test.afterAll(async () => {
		await adminPhone?.close();
		await collectorPhone?.close();
	});

	test('the known-overflow list only names screens that exist', () => {
		const slugs = new Set([...staff, ...portal].map((screen) => screen.slug));
		for (const slug of Object.keys(KNOWN_OVERFLOW))
			expect(slugs, `KNOWN_OVERFLOW names an unknown screen: ${slug}`).toContain(slug);
	});

	test('staff screens do not scroll sideways', async () => {
		test.setTimeout(300_000);
		await sweep(adminPhone, staff);
	});

	test('portal screens do not scroll sideways', async () => {
		await sweep(collectorPhone, portal);
	});

	// UX plan PR 13 (audit A7 and A10): the home of a campaign with real volumes is short, says
	// what waits and where it is resolved, and shows whole pesos.
	test('the campaign home is 2.5 screens or shorter, with no cents', async () => {
		const page = await adminPhone.newPage();
		await open(page, staff.find((screen) => screen.slug === '03-campaign-workbench')!.path);
		const screens = await page.evaluate(
			() => document.scrollingElement!.scrollHeight / window.innerHeight
		);
		expect(screens, 'screens at 375 x 812 with the demo campaign').toBeLessThanOrEqual(2.5);
		const text = (await page.getByRole('main').innerText()).replace(/\u00a0/g, ' ');
		expect(text).not.toMatch(/\$ [\d.]+,\d/);
		// The demo has payments sent by a collector: the item leads to that collector's settlement.
		const sent = page.locator('#dash-todo [data-task^="submitted-"]').first();
		await expect(sent).toContainText('sin procesar');
		await expect(sent.getByRole('link')).toHaveAttribute('href', /\/settlements\/[0-9a-f-]{36}$/);
		await page.close();
	});

	// UX plan PR 12b (audit A9): a party the role cannot read is left out or named in Spanish, never
	// printed as the repositories' old English stand-ins. Every staff screen is fetched as each staff
	// role; the page's HTML also carries the data it was rendered from.
	//
	// The screens are fetched from inside a signed-in page. `context.request` does not carry the
	// app's session here (every request is redirected to /login), which made the first version of
	// this sweep read the login page and pass without checking anything: so each answer is also
	// required to be the app's own page, not the login.
	test('no staff screen says «Unknown», for any staff role', async ({ browser }) => {
		test.setTimeout(300_000);
		for (const role of ['admin', 'operator', 'treasurer', 'readOnly'] as const) {
			const context = await browser.newContext({
				baseURL,
				serviceWorkers: 'block',
				locale: 'es-AR',
				storageState: STATE[role]
			});
			const page = await context.newPage();
			await open(page, '/campaigns');
			let answered = 0;
			for (const screen of staff) {
				const answer = await page.evaluate(async (path) => {
					const response = await fetch(path, { credentials: 'same-origin' });
					return { url: response.url, status: response.status, html: await response.text() };
				}, screen.path);
				expect
					.soft(new URL(answer.url).pathname, `${screen.slug} as ${role} was sent to the login`)
					.not.toMatch(/^\/login/);
				expect
					.soft(answer.html, `${screen.slug} as ${role}`)
					.not.toMatch(/Unknown (buyer|collector|campaign|bond)/);
				if (answer.status === 200) answered += 1;
			}
			// Every role opens a good part of the screens (read-only, the least, about half): a sweep
			// that only met refusals proves nothing.
			expect(answered, `screens answered with 200 as ${role}`).toBeGreaterThan(staff.length / 3);
			await context.close();
		}
	});
});

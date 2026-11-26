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
import { ANONYMOUS, STATE } from './auth-state';
import { login, open } from './helpers';

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
	'00-home': 'audit A7, the campaign card «pendiente $ 4.370.000» does not wrap (plan PR 13)',
	'03-campaign-workbench': 'audit A7, «pendiente $ 4.370.000» does not wrap (plan PR 13)',
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

	// UX plan PR 12b (audit A9): a party the role cannot read is left out or named in Spanish, never
	// printed as the repositories' old English stand-ins. Every staff screen is requested as each
	// staff role; the page's HTML also carries the data it was rendered from.
	test('no staff screen says «Unknown», for any staff role', async ({ browser }) => {
		test.setTimeout(300_000);
		const config = resolveSeedConfig();
		const roles = ['admin', 'operator', 'treasurer', 'read-only'] as const;
		for (const role of roles) {
			const user =
				role === 'admin'
					? config.admin
					: config.fixtures.find((fixture) => fixture.roleNames.includes(role));
			if (!user) throw new Error(`The fixture ${role} is missing: run seed:admin first.`);
			const context = await browser.newContext({
				baseURL,
				locale: 'es-AR',
				storageState: ANONYMOUS
			});
			await login(await context.newPage(), user);
			for (const screen of staff) {
				const response = await context.request.get(screen.path);
				expect
					.soft(await response.text(), `${screen.slug} as ${role}`)
					.not.toMatch(/Unknown (buyer|collector|campaign|bond)/);
			}
			await context.close();
		}
	});
});

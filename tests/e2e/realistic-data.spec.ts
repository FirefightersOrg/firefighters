import { expect, test, type Browser, type BrowserContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
	findDemoIds,
	portalScreens,
	signedInClient,
	staffScreens,
	type Screen
} from '../../scripts/demo-screens';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import { seedDemo } from '../../scripts/seed-demo';
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
	'03-campaign-workbench': 'audit A7, «pendiente $ 4.370.000» does not wrap (plan PR 13)',
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

async function phone(browser: Browser, user: { email: string; password: string }) {
	const signIn = await browser.newContext({ baseURL, locale: 'es-AR' });
	await login(await signIn.newPage(), user);
	const storageState = await signIn.storageState();
	await signIn.close();
	return browser.newContext({
		baseURL,
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
		const collector = config.fixtures.find((user) => user.roleNames.includes('collector'));
		if (!collector) throw new Error('The fixture collector is missing: run seed:admin first.');

		await seedDemo();
		const ids = await findDemoIds(await signedInClient(config.supabaseUrl, anonKey, config.admin));
		staff = staffScreens(ids);
		portal = portalScreens(ids);
		adminPhone = await phone(browser, config.admin);
		collectorPhone = await phone(browser, collector);
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

	test('the five demo documents fit the A4 printable width', async () => {
		const slugs = [
			'23-delivery-note-print',
			'44-settlement-print',
			'45-payment-print',
			'77-prize-delivery-certificate',
			'78-prize-unawarded-certificate'
		];
		const page = await adminPhone.newPage();
		await page.setViewportSize({ width: 702, height: 1000 });
		await page.emulateMedia({ media: 'print' });
		for (const slug of slugs) {
			const screen = staff.find((item) => item.slug === slug);
			expect(screen, `Missing demo document ${slug}`).toBeDefined();
			await open(page, screen!.path);
			await page.evaluate(() => document.fonts.ready);
			const sheets = page.locator('.doc-sheet');
			expect(await sheets.count(), slug).toBeGreaterThan(0);
			// A4 less the 12 mm margins on both sides, in CSS pixels at 96 dpi.
			const printableWidth = (186 / 25.4) * 96;
			const overflow = await sheets.evaluateAll(
				(articles, width) =>
					articles.map((article) => {
						const bounds = article.getBoundingClientRect();
						const rightmost = Math.max(
							bounds.right,
							...Array.from(
								article.querySelectorAll('*'),
								(element) => element.getBoundingClientRect().right
							)
						);
						return Math.max(bounds.width - width, rightmost - bounds.right);
					}),
				printableWidth
			);
			for (const amount of overflow)
				expect(amount, `${slug} exceeds A4 width`).toBeLessThanOrEqual(1);
			const pdf = await page.pdf({ format: 'A4', preferCSSPageSize: true });
			const pdfText = pdf.toString('latin1');
			expect(pdfText.startsWith('%PDF-'), slug).toBe(true);
			const boxes = [...pdfText.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)];
			expect(boxes.length, `${slug} has no PDF pages`).toBeGreaterThan(0);
			for (const [, width, height] of boxes) {
				expect(Number(width), `${slug} page width`).toBeCloseTo(595.28, 0);
				expect(Number(height), `${slug} page height`).toBeCloseTo(841.89, 0);
			}
		}
		await page.close();
	});

	test('the five documents are accessible in both themes and by keyboard', async ({ browser }) => {
		const slugs = [
			'23-delivery-note-print',
			'44-settlement-print',
			'45-payment-print',
			'77-prize-delivery-certificate',
			'78-prize-unawarded-certificate'
		];
		for (const colorScheme of ['light', 'dark'] as const) {
			const context = await browser.newContext({
				baseURL,
				viewport: { width: 375, height: 812 },
				colorScheme,
				storageState: await adminPhone.storageState()
			});
			const page = await context.newPage();
			for (const slug of slugs) {
				const screen = staff.find((item) => item.slug === slug);
				expect(screen, `Missing demo document ${slug}`).toBeDefined();
				await open(page, screen!.path);
				expect(
					(await new AxeBuilder({ page }).analyze()).violations,
					`${slug} ${colorScheme}`
				).toEqual([]);
				await page.keyboard.press('Tab');
				await expect(page.getByRole('button', { name: 'Imprimir' })).toBeFocused();
			}
			await context.close();
		}
	});

	test('portal screens do not scroll sideways', async () => {
		await sweep(collectorPhone, portal);
	});
});

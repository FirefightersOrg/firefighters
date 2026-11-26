import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext } from '@playwright/test';
import {
	findDemoIds,
	portalScreens,
	signedInClient,
	staffScreens,
	type Screen
} from './demo-screens';
import { resolveSeedConfig } from './seed-admin';
import { assertOnBaseUrl, resolveLocalBaseUrl } from './ux-local';

/**
 * Walks every screen of the app with each role, at 375 px and 1280 px, in light and dark, and saves
 * a full-page screenshot plus a `report.json` with what it measured on each one (HTTP status, page
 * height in screens, horizontal overflow, number of controls, links and tables, console errors).
 * Used for the UX audit (`docs/ux/before/`) and again after the redesign (`docs/ux/after/`).
 *
 * Every role, width and theme is walked and measured (they are all rows of the report). To keep the
 * folder small, screenshots are saved for the admin and the collector in full, and for the other
 * roles only in light and only where the screen differs from what the admin sees. Pages longer than
 * eight screens are cut there (the report keeps their real length).
 *
 * It needs the demo campaign (`pnpm seed:demo`) and a running dev server:
 *
 *   APP_ENV=local pnpm exec tsx scripts/ux-walkthrough.ts docs/ux/before
 *
 * Options (environment): UX_BASE_URL (default http://127.0.0.1:5173; only localhost is accepted,
 * because the script signs in with the seed credentials), UX_ROLES (comma list),
 * UX_ONLY (comma list of substrings of the screen slug), UX_QUALITY (JPEG quality, default 60).
 */

const BASE_URL = resolveLocalBaseUrl(process.env.UX_BASE_URL);
const QUALITY = Number(process.env.UX_QUALITY ?? 60);
const VIEWPORTS = [
	{ name: '375', width: 375, height: 812, touch: true },
	{ name: '1280', width: 1280, height: 800, touch: false }
] as const;
const SCHEMES = ['light', 'dark'] as const;
/** Roles whose every screen is saved; the others only save what differs from the admin's view. */
const FULL_ROLES = ['admin', 'collector'];
/** Screenshots stop at this many viewport heights. */
const MAX_SCREENS = 8;
const ROLE_EMAIL: Record<string, string> = {
	admin: 'admin@firefighters.local',
	treasurer: 'treasurer@firefighters.local',
	operator: 'operator@firefighters.local',
	readonly: 'readonly@firefighters.local',
	collector: 'collector@firefighters.local'
};

async function login(browser: Browser, email: string, password: string) {
	const context = await browser.newContext({ locale: 'es-AR' });
	const page = await context.newPage();
	await page.goto(`${BASE_URL}/login`);
	await page.waitForLoadState('networkidle');
	assertOnBaseUrl(page.url(), BASE_URL);
	await page.getByLabel('Correo electrónico').fill(email);
	await page.getByLabel('Contraseña').fill(password);
	await page.getByRole('button', { name: /ingresar|iniciar sesión/i }).click();
	await page.waitForURL((url) => !url.pathname.startsWith('/login'));
	const state = await context.storageState();
	await context.close();
	return state;
}

interface Measured {
	status: number | null;
	heading: string;
	controls: number;
	links: number;
}
interface Row {
	role: string;
	viewport: string;
	scheme: string;
	slug: string;
	path: string;
	status: number | null;
	finalPath: string;
	title: string;
	heading: string;
	screens: number;
	overflow: number;
	controls: number;
	links: number;
	tables: number;
	consoleErrors: string[];
	file: string | null;
}

async function capture(
	context: BrowserContext,
	meta: { role: string; viewport: (typeof VIEWPORTS)[number]; scheme: string },
	screen: Screen,
	outDir: string,
	/** Decides, from what was measured, whether this capture is worth a screenshot. */
	keep: (measured: Measured) => boolean = () => true
): Promise<Row> {
	const page = await context.newPage();
	const consoleErrors: string[] = [];
	page.on('console', (message) => {
		if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 200));
	});
	const response = await page.goto(`${BASE_URL}${screen.path}`);
	await page.waitForLoadState('networkidle');
	const status = response?.status() ?? null;
	const measured = await page.evaluate(() => {
		// No named helpers in here: tsx wraps them in `__name`, which does not exist in the page.
		const doc = document.scrollingElement!;
		return {
			title: document.title,
			heading: document.querySelector('h1')?.textContent?.trim() ?? '',
			screens: Math.round((doc.scrollHeight / window.innerHeight) * 10) / 10,
			overflow: doc.scrollWidth - window.innerWidth,
			controls: [
				...document.querySelectorAll(
					'main button, main input:not([type=hidden]), main select, main textarea, main summary'
				)
			].filter((el) => el.getBoundingClientRect().width > 0).length,
			links: [...document.querySelectorAll('main a[href]')].filter(
				(el) => el.getBoundingClientRect().width > 0
			).length,
			tables: document.querySelectorAll('main table').length
		};
	});
	let file: string | null = null;
	if (keep({ status, ...measured })) {
		const dir = join(outDir, meta.role, `${meta.viewport.name}-${meta.scheme}`);
		mkdirSync(dir, { recursive: true });
		file = join(dir, `${screen.slug}.jpg`);
		// Very long pages are cut at MAX_SCREENS viewports: the report keeps their real length.
		const height = Math.min(
			Math.ceil(measured.screens * meta.viewport.height),
			MAX_SCREENS * meta.viewport.height
		);
		await page.screenshot({
			path: file,
			fullPage: true,
			clip: { x: 0, y: 0, width: meta.viewport.width + Math.max(0, measured.overflow), height },
			type: 'jpeg',
			quality: QUALITY
		});
	}
	const finalPath = new URL(page.url()).pathname;
	await page.close();
	return {
		role: meta.role,
		viewport: meta.viewport.name,
		scheme: meta.scheme,
		slug: screen.slug,
		path: screen.path,
		status,
		finalPath,
		...measured,
		consoleErrors,
		file
	};
}

async function main() {
	const outDir = resolve(process.argv[2] ?? 'docs/ux/before');
	const envPath = resolve(process.cwd(), '.env');
	if (existsSync(envPath)) process.loadEnvFile(envPath);
	const config = resolveSeedConfig();
	if (config.appEnv !== 'local') throw new Error('ux-walkthrough only runs with APP_ENV=local.');
	const anonKey = process.env.PUBLIC_SUPABASE_ANON_KEY?.trim();
	if (!anonKey) throw new Error('PUBLIC_SUPABASE_ANON_KEY is required.');
	const admin = await signedInClient(config.supabaseUrl, anonKey, config.admin);
	const ids = await findDemoIds(admin);

	const roles = (process.env.UX_ROLES ?? Object.keys(ROLE_EMAIL).join(',')).split(',');
	const only = process.env.UX_ONLY?.split(',');
	const browser = await chromium.launch();
	const rows: Row[] = [];
	const adminLight = new Map<string, Measured>();
	mkdirSync(outDir, { recursive: true });

	// The login screen, signed out.
	for (const viewport of VIEWPORTS)
		for (const scheme of SCHEMES) {
			const context = await browser.newContext({
				locale: 'es-AR',
				timezoneId: 'America/Argentina/Buenos_Aires',
				viewport: { width: viewport.width, height: viewport.height },
				hasTouch: viewport.touch,
				colorScheme: scheme
			});
			rows.push(
				await capture(
					context,
					{ role: 'signed-out', viewport, scheme },
					{
						slug: '00-login',
						path: '/login'
					},
					outDir
				)
			);
			await context.close();
		}

	for (const role of roles) {
		const user = [config.admin, ...config.fixtures].find((u) => u.email === ROLE_EMAIL[role]);
		if (!user) throw new Error(`Unknown role ${role}`);
		const storageState = await login(browser, user.email, user.password);
		const screens = (
			role === 'collector'
				? [...portalScreens(ids), ...staffScreens(ids).slice(0, 4)]
				: role === 'admin'
					? [...staffScreens(ids), ...portalScreens(ids).slice(0, 2)]
					: staffScreens(ids)
		).filter((screen) => !only || only.some((part) => screen.slug.includes(part)));
		for (const viewport of VIEWPORTS)
			for (const scheme of SCHEMES) {
				const context = await browser.newContext({
					locale: 'es-AR',
					timezoneId: 'America/Argentina/Buenos_Aires',
					viewport: { width: viewport.width, height: viewport.height },
					hasTouch: viewport.touch,
					colorScheme: scheme,
					storageState
				});
				for (const screen of screens) {
					const key = `${viewport.name}:${screen.slug}`;
					const row = await capture(
						context,
						{ role, viewport, scheme },
						screen,
						outDir,
						(measured) => {
							if (FULL_ROLES.includes(role)) return true;
							// Other staff roles: light only (dark does not depend on the role), and only the
							// screens where the role sees something different from the admin.
							if (scheme !== 'light') return false;
							const reference = adminLight.get(key);
							return (
								screen.slug.includes('workbench') ||
								!reference ||
								reference.status !== measured.status ||
								reference.heading !== measured.heading ||
								reference.controls !== measured.controls ||
								reference.links !== measured.links
							);
						}
					);
					if (role === 'admin' && scheme === 'light') adminLight.set(key, row);
					rows.push(row);
				}
				await context.close();
				console.log(`${role} ${viewport.name} ${scheme}: ${screens.length} screens`);
			}
	}
	await browser.close();

	const relative = rows.map((row) => ({
		...row,
		path: row.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id'),
		finalPath: row.finalPath.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id'),
		file: row.file?.replace(`${outDir}/`, '') ?? null
	}));
	writeFileSync(join(outDir, 'report.json'), `${JSON.stringify(relative, null, '\t')}\n`);
	console.log(`${rows.length} captures in ${outDir}`);
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error('ux-walkthrough failed:', err);
		process.exit(1);
	});

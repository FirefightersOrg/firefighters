import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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

const CAMPAIGN_NAME = 'Bono Contribución 2026';
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

interface Ids {
	campaign: string;
	draft: string;
	soldBond: string;
	availableBond: string;
	lostBond: string;
	buyer: string;
	collector: string;
	linkedCollector: string;
	sale: string;
	portalSale: string;
	portalBond: string;
	portalBuyer: string;
	note: string;
	closedSettlement: string;
	openSettlement: string;
	payment: string;
	finishedDraw: string;
	rosterDraw: string;
	scheduledDraw: string;
	deliveredPrize: string;
	unawardedPrize: string;
}
type Screen = { slug: string; path: string };

const options = { auth: { autoRefreshToken: false, persistSession: false } };

async function one(
	client: SupabaseClient,
	table: string,
	filter: (query: ReturnType<ReturnType<SupabaseClient['from']>['select']>) => unknown
): Promise<string> {
	const { data, error } = (await filter(client.from(table).select('id')).limit(1)) as {
		data: { id: string }[] | null;
		error: { message: string } | null;
	};
	if (error || !data?.[0])
		throw new Error(`No ${table} row for the walkthrough: ${error?.message}`);
	return data[0].id;
}

async function findIds(admin: SupabaseClient): Promise<Ids> {
	const campaign = await one(admin, 'campaigns', (q) => q.eq('name', CAMPAIGN_NAME));
	const draft = await one(admin, 'campaigns', (q) => q.eq('status', 'draft'));
	const inCampaign = (q: { eq: (column: string, value: string) => typeof q }) =>
		q.eq('campaign_id', campaign);
	const linked = await admin
		.from('collectors')
		.select('id')
		.not('user_profile_id', 'is', null)
		.limit(1);
	const linkedCollector = linked.data?.[0]?.id as string;
	const openSettlement = await one(admin, 'settlements', (q) =>
		inCampaign(q).eq('status', 'open').eq('collector_id', linkedCollector)
	);
	const closed = await admin
		.from('settlements')
		.select('id, collector_id')
		.eq('campaign_id', campaign)
		.eq('status', 'closed')
		.neq('collector_id', linkedCollector)
		.order('total_amount', { ascending: false })
		.limit(1);
	const closedSettlement = closed.data![0].id as string;
	const collector = closed.data![0].collector_id as string;
	const payment = await one(admin, 'payments', (q) => q.eq('settlement_id', closedSettlement));
	const sale = await admin
		.from('payments')
		.select('sale_id, sales!inner(bond_id, buyer_id, payment_mode)')
		.eq('settlement_id', closedSettlement)
		.eq('sales.payment_mode', 'installments')
		.limit(1);
	const saleRow = sale.data![0] as unknown as {
		sale_id: string;
		sales: { bond_id: string; buyer_id: string };
	};
	const portal = await admin
		.from('sales')
		.select('id, bond_id, buyer_id')
		.eq('campaign_id', campaign)
		.eq('collector_id', linkedCollector)
		.eq('payment_mode', 'installments')
		.limit(1);
	const finishedDraw = await one(admin, 'draws', (q) =>
		inCampaign(q).eq('status', 'roster_frozen')
	);
	const prizes = await admin
		.from('prizes')
		.select('id, status')
		.eq('draw_id', finishedDraw)
		.order('position');
	return {
		campaign,
		draft,
		soldBond: saleRow.sales.bond_id,
		availableBond: await one(admin, 'bonds', (q) =>
			inCampaign(q).eq('commercial_status', 'available')
		),
		lostBond: await one(admin, 'bonds', (q) => inCampaign(q).eq('commercial_status', 'lost')),
		buyer: saleRow.sales.buyer_id,
		collector,
		linkedCollector,
		sale: saleRow.sale_id,
		portalSale: portal.data![0].id,
		portalBond: portal.data![0].bond_id,
		portalBuyer: portal.data![0].buyer_id,
		note: await one(admin, 'delivery_notes', (q) => inCampaign(q).eq('collector_id', collector)),
		closedSettlement,
		openSettlement,
		payment,
		finishedDraw,
		rosterDraw: await one(admin, 'draws', (q) => inCampaign(q).eq('status', 'roster_generated')),
		scheduledDraw: await one(admin, 'draws', (q) => inCampaign(q).eq('status', 'scheduled')),
		deliveredPrize: prizes.data![0].id,
		unawardedPrize: prizes.data![1].id
	};
}

function staffScreens(i: Ids): Screen[] {
	const c = `/campaigns/${i.campaign}`;
	const s = (slug: string, path: string): Screen => ({ slug, path });
	return [
		s('00-home', '/'),
		s('01-campaigns-list', '/campaigns'),
		s('02-campaign-new', '/campaigns/new'),
		s('03-campaign-workbench', c),
		s('04-campaign-draft', `/campaigns/${i.draft}`),
		s('05-campaign-data-and-rules', `${c}/configuracion`),
		s('10-bonds-list', `${c}/bonds`),
		s('11-bonds-search-result', `${c}/bonds?base=12`),
		s('12-bonds-search-empty', `${c}/bonds?base=4321`),
		s('13-bond-sold', `${c}/bonds/${i.soldBond}`),
		s('14-bond-available', `${c}/bonds/${i.availableBond}`),
		s('15-bond-lost', `${c}/bonds/${i.lostBond}`),
		s('16-bond-new', `${c}/bonds/new`),
		s('17-pata-new', `${c}/bonds/pata/new`),
		s('18-bonds-scan', `${c}/bonds/scan`),
		s('19-bonds-import', `${c}/bonds/import`),
		s('20-deliveries-list', `${c}/deliveries`),
		s('21-delivery-new', `${c}/deliveries/new`),
		s('22-delivery-note', `${c}/deliveries/${i.note}`),
		s('23-delivery-note-print', `${c}/deliveries/${i.note}/print`),
		s('30-sales-list', `${c}/sales`),
		s('31-sale-new', `${c}/sales/new`),
		s('32-sale-detail', `${c}/sales/${i.sale}`),
		s('40-settlements-list', `${c}/settlements`),
		s('41-settlement-new', `${c}/settlements/new`),
		s('42-settlement-open', `${c}/settlements/${i.openSettlement}`),
		s('43-settlement-closed', `${c}/settlements/${i.closedSettlement}`),
		s('44-settlement-print', `${c}/settlements/${i.closedSettlement}/print`),
		s('45-payment-print', `${c}/payments/${i.payment}/print`),
		s('50-collectors-list', `${c}/collectors`),
		s('51-collector-new', `${c}/collectors/new`),
		s('52-collector-detail', `${c}/collectors/${i.collector}`),
		s('53-collector-ledger', `${c}/collectors/${i.collector}/ledger`),
		s('54-commissions', `${c}/commissions`),
		s('60-buyers-list', `${c}/buyers`),
		s('61-buyer-new', `${c}/buyers/new`),
		s('62-buyer-detail', `${c}/buyers/${i.buyer}`),
		s('70-draws-list', `${c}/draws`),
		s('71-draw-new', `${c}/draws/new`),
		s('72-draw-scheduled', `${c}/draws/${i.scheduledDraw}`),
		s('73-draw-roster-generated', `${c}/draws/${i.rosterDraw}`),
		s('74-draw-roster-frozen', `${c}/draws/${i.finishedDraw}`),
		s('75-draw-roster', `${c}/draws/${i.finishedDraw}/roster`),
		s('76-draw-winners', `${c}/draws/${i.finishedDraw}/winners`),
		s(
			'77-prize-delivery-certificate',
			`${c}/draws/${i.finishedDraw}/winners/${i.deliveredPrize}/delivery-certificate`
		),
		s(
			'78-prize-unawarded-certificate',
			`${c}/draws/${i.finishedDraw}/winners/${i.unawardedPrize}/unawarded-certificate`
		),
		s('80-reports-operational', `${c}/reports`),
		s('81-reports-financial', `${c}/reports/financial`),
		s(
			'82-reports-financial-collector',
			`${c}/reports/financial?collector=${i.collector}&draw=${i.finishedDraw}`
		),
		s('90-audit', `${c}/audit`),
		s('91-backups', `${c}/backups`),
		s('98-not-found', `${c}/bonds/00000000-0000-4000-8000-000000000000`)
	];
}

function portalScreens(i: Ids): Screen[] {
	const p = `/portal/${i.campaign}`;
	const s = (slug: string, path: string): Screen => ({ slug, path });
	return [
		s('p0-portal-home', '/portal'),
		s('p1-my-bonds', `${p}/bonos`),
		s('p2-my-bond', `${p}/bonos/${i.portalBond}`),
		s('p3-my-sales', `${p}/ventas`),
		s('p4-my-sale', `${p}/ventas/${i.portalSale}`),
		s('p5-my-buyers', `${p}/compradores`),
		s('p6-my-buyer', `${p}/compradores/${i.portalBuyer}`),
		s('p7-to-collect', `${p}/por-cobrar`),
		s('p8-my-account', `${p}/cuenta`)
	];
}

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
	const auth = createClient(config.supabaseUrl, anonKey, options);
	const session = await auth.auth.signInWithPassword({
		email: config.admin.email,
		password: config.admin.password
	});
	if (session.error || !session.data.session) throw new Error('Could not sign in the admin.');
	const admin = createClient(config.supabaseUrl, anonKey, {
		...options,
		global: { headers: { Authorization: `Bearer ${session.data.session.access_token}` } }
	});
	const ids = await findIds(admin);

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

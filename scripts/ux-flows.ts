import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Locator, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { resolveSeedConfig } from './seed-admin';
import { DEMO_CAMPAIGN_NAME } from './seed-demo';
import { assertOnBaseUrl, resolveLocalBaseUrl, runEach } from './ux-local';

/**
 * Runs the critical flows on a phone-sized screen (375 px) the way a person would, counting what
 * each one costs: screens visited, taps, fields typed and choices made. It saves a screenshot per
 * step and a `flows.json` with the counts. Used by the UX audit to compare before and after.
 *
 * It needs the demo campaign (`pnpm seed:demo`) and a running dev server, and it WRITES data (a
 * sale, payments, a closed settlement, a delivery, a draw, a collector submission), so run it on a
 * database that can be reset:
 *
 *   APP_ENV=local pnpm exec tsx scripts/ux-flows.ts docs/ux/before/flows
 *
 * Options (environment): UX_BASE_URL (default http://127.0.0.1:5173; only localhost is accepted,
 * because the script signs in with the seed credentials and writes data), UX_FLOWS (comma list).
 *
 * If a flow fails, the report still has what it recorded (marked `failed`), and the script exits 1.
 */

const BASE_URL = resolveLocalBaseUrl(process.env.UX_BASE_URL);

interface Step {
	kind: 'screen' | 'tap' | 'type' | 'choose';
	label: string;
}

/** Records what a person does in one flow. */
class Recorder {
	steps: Step[] = [];
	notes: string[] = [];
	failed = false;
	private shots = 0;
	constructor(
		readonly name: string,
		readonly page: Page,
		private readonly dir: string
	) {
		mkdirSync(dir, { recursive: true });
	}
	async settle() {
		await this.page.waitForLoadState('networkidle');
	}
	/** A new screen (or a new state of one) the person has to read. */
	async screen(label: string) {
		await this.settle();
		this.steps.push({ kind: 'screen', label });
		this.shots += 1;
		const file = `${String(this.shots).padStart(2, '0')}-${label
			.toLowerCase()
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/(^-|-$)/g, '')}.jpg`;
		// From the top, so the sticky header is not captured in the middle of the page.
		await this.page.evaluate(() => window.scrollTo(0, 0));
		await this.page.screenshot({
			path: join(this.dir, file),
			fullPage: true,
			type: 'jpeg',
			quality: 60
		});
	}
	async tap(target: Locator, label: string) {
		await this.settle();
		await target.click();
		this.steps.push({ kind: 'tap', label });
	}
	async type(target: Locator, value: string, label: string) {
		await this.settle();
		await target.fill(value);
		this.steps.push({ kind: 'type', label });
	}
	async choose(
		target: Locator,
		option: { label?: string; index?: number; value?: string },
		label: string
	) {
		await this.settle();
		await target.selectOption(option);
		this.steps.push({ kind: 'choose', label });
	}
	/** A key pressed on a field (Enter to search, Enter to confirm): an action like a tap. */
	async press(target: Locator, key: string, label: string) {
		await this.settle();
		await target.press(key);
		this.steps.push({ kind: 'tap', label });
	}
	async check(target: Locator, label: string) {
		await this.settle();
		await target.check();
		this.steps.push({ kind: 'choose', label });
	}
	note(text: string) {
		this.notes.push(text);
	}
	summary() {
		const count = (kind: Step['kind']) => this.steps.filter((step) => step.kind === kind).length;
		return {
			flow: this.name,
			failed: this.failed,
			screens: count('screen'),
			taps: count('tap'),
			fields: count('type'),
			choices: count('choose'),
			actions: count('tap') + count('type') + count('choose'),
			notes: this.notes,
			steps: this.steps
		};
	}
}

function baDay(days = 0) {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: 'America/Argentina/Buenos_Aires'
	}).format(new Date(Date.now() + days * 86_400_000));
}

async function phone(browser: Browser, email: string, password: string) {
	const context = await browser.newContext({
		locale: 'es-AR',
		timezoneId: 'America/Argentina/Buenos_Aires',
		viewport: { width: 375, height: 812 },
		hasTouch: true
	});
	const page = await context.newPage();
	await page.goto(`${BASE_URL}/login`);
	await page.waitForLoadState('networkidle');
	assertOnBaseUrl(page.url(), BASE_URL);
	await page.getByLabel('Correo electrónico').fill(email);
	await page.getByLabel('Contraseña').fill(password);
	await page.getByRole('button', { name: /ingresar|iniciar sesión/i }).click();
	await page.waitForURL((url) => !url.pathname.startsWith('/login'));
	return page;
}

type Flow = (r: Recorder, campaign: string, eligibleNumber: number) => Promise<void>;

const flows: Record<string, { role: 'admin' | 'collector'; run: Flow }> = {
	'search-bond': {
		role: 'admin',
		run: async (r, campaign) => {
			await r.page.goto(`${BASE_URL}/campaigns/${campaign}`);
			await r.screen('Campaña');
			await r.type(r.page.locator('input[name="base"]').first(), '57', 'Número de bono');
			await r.tap(r.page.getByRole('button', { name: 'Buscar bono' }), 'Buscar bono');
			// UX plan PR 9: a number that matches one bond opens its record, with no list in between.
			await r.page.waitForURL(/\/bonds\/[0-9a-f-]{36}$/);
			await r.screen('Ficha del bono');
		}
	},
	'register-sale': {
		role: 'admin',
		run: async (r, campaign) => {
			await r.page.goto(`${BASE_URL}/campaigns/${campaign}`);
			await r.screen('Campaña');
			await r.tap(r.page.getByRole('link', { name: 'Registrar venta' }), 'Registrar venta');
			await r.screen('Registrar venta, vacío');
			await r.type(r.page.locator('#query'), '35', 'Número del bono');
			await r.tap(r.page.locator('form[action="?/lookup"] button[type="submit"]'), 'Buscar');
			// UX plan PR 12: the one bond that matches is chosen without another action.
			await r.page.locator('[data-chosen-bond]').waitFor();
			await r.screen('Bono encontrado');
			// A tap, not `check()`: the step collapses as soon as the buyer is chosen.
			await r.tap(r.page.locator('[data-step="buyer"] input[type="radio"]').nth(4), 'Comprador');
			await r.page.locator('[data-chosen-buyer]').waitFor();
			await r.tap(
				r.page.locator('[data-step="payment"]').getByText('En cuotas', { exact: true }),
				'Modalidad'
			);
			await r.screen('Venta lista para confirmar');
			await r.tap(r.page.locator('[data-confirm-sale]'), 'Confirmar venta');
			await r.page.waitForURL(/\/sales\/[0-9a-f-]{36}$/);
			await r.screen('Venta registrada');
		}
	},
	// Probe: does searching for a buyer keep the bond that was already found?
	'register-sale-buyer-search': {
		role: 'admin',
		run: async (r, campaign) => {
			await r.page.goto(`${BASE_URL}/campaigns/${campaign}/sales/new`);
			await r.type(r.page.locator('#query'), '34', 'Número del bono');
			await r.tap(r.page.locator('form[action="?/lookup"] button[type="submit"]'), 'Buscar');
			await r.page.locator('[data-chosen-bond]').waitFor();
			await r.screen('Bono elegido');
			await r.type(r.page.locator('#buyer-search'), 'Gómez', 'Buscar compradores');
			await r.tap(
				r.page.locator('[data-step="buyer"] form[role="search"] button[type="submit"]'),
				'Buscar comprador'
			);
			await r.page.waitForURL(/[?&]buyer=/);
			await r.screen('Después de buscar el comprador');
			const kept = await r.page.locator('[data-chosen-bond]').count();
			r.note(
				kept === 0
					? 'Searching for a buyer reloads the page and DROPS the bond that was found: it has to be searched again.'
					: 'The found bond survives the buyer search.'
			);
		}
	},
	settlement: {
		role: 'admin',
		run: async (r, campaign) => {
			await r.page.goto(`${BASE_URL}/campaigns/${campaign}`);
			await r.screen('Campaña');
			await r.tap(r.page.getByRole('link', { name: 'Registrar pago' }), 'Registrar pago');
			await r.screen('Registrar pago: elegir el cobrador');
			await r.choose(r.page.locator('#collectorId'), { label: 'Héctor Acosta' }, 'Cobrador');
			await r.tap(
				r.page.getByRole('button', { name: 'Abrir rendición y cargar pagos' }),
				'Abrir rendición y cargar pagos'
			);
			await r.page.waitForURL(/\/settlements\/[0-9a-f-]{36}$/);
			await r.screen('Rendición abierta');
			// Not part of the flow: which of the collector's bonds have debt (the person reads the number
			// on the stub; the script has to look for two).
			const number = r.page.getByLabel('Número del bono que pagó');
			const bonds: number[] = [];
			for (let n = 1; n <= 240 && bonds.length < 2; n++) {
				await number.fill(String(n));
				await number.press('Enter');
				if (await r.page.locator('[data-found-sale]').count()) bonds.push(n);
			}
			await number.fill('');
			if (bonds.length < 2)
				throw new Error('The demo collector has fewer than two bonds with debt.');
			r.note('Each payment is: the bond number, Enter (shows who and how much), Enter (adds it).');
			for (const [index, bond] of bonds.entries()) {
				await r.type(number, String(bond), 'Número del bono');
				await r.press(number, 'Enter', 'Enter: buscar');
				await r.page.locator('[data-found-sale]').waitFor();
				if (index === 0) await r.screen('Pago listo para agregar');
				await r.press(number, 'Enter', 'Enter: agregar pago');
				await r.page.getByText('Pago agregado.').waitFor();
				await r.page.locator('[data-found-sale]').waitFor({ state: 'detached' });
			}
			await r.screen('Dos pagos agregados');
			// «Revisar y cerrar» in the task bar on a phone, «Cerrar rendición» beside the sheet on desktop.
			await r.tap(
				r.page
					.locator('button:visible', { hasText: /^\s*(Revisar y cerrar|Cerrar rendición)\s*$/ })
					.first(),
				'Cerrar rendición'
			);
			await r.page.getByRole('dialog').waitFor();
			await r.screen('Confirmar el cierre');
			await r.tap(
				r.page.getByRole('dialog').getByRole('button', { name: 'Cerrar rendición' }),
				'Confirmar cierre'
			);
			await r.page.getByText('Rendición cerrada.').waitFor();
			await r.screen('Rendición cerrada');
			await r.tap(
				r.page.getByRole('link', { name: 'Imprimir remito de rendición' }).first(),
				'Imprimir remito'
			);
			await r.screen('Remito de rendición');
		}
	},
	'deliver-bonds': {
		role: 'admin',
		run: async (r, campaign) => {
			await r.page.goto(`${BASE_URL}/campaigns/${campaign}`);
			await r.screen('Campaña');
			await r.tap(
				r.page.getByRole('link', { name: 'Entregar bonos a un cobrador' }),
				'Entregar bonos'
			);
			await r.screen('Nueva entrega, vacía');
			await r.type(r.page.locator('#from'), '211', 'Rango desde');
			await r.type(r.page.locator('#to'), '215', 'Rango hasta');
			await r.tap(r.page.getByRole('button', { name: 'Agregar' }), 'Agregar');
			await r.page.getByText('agregados.').waitFor();
			await r.choose(r.page.locator('#collectorId'), { label: 'Raúl Sosa' }, 'Cobrador');
			await r.screen('Entrega lista');
			await r.tap(
				r.page.getByRole('button', { name: 'Entregar y emitir remito' }),
				'Entregar y emitir remito'
			);
			await r.page.waitForURL(/\/deliveries\/[0-9a-f-]{36}$/);
			await r.screen('Remito emitido');
			await r.tap(r.page.locator('main a[href$="/print"]').first(), 'Imprimir remito');
			await r.screen('Remito para imprimir');
		}
	},
	draw: {
		role: 'admin',
		run: async (r, campaign, eligibleNumber) => {
			await r.page.goto(`${BASE_URL}/campaigns/${campaign}`);
			await r.screen('Campaña');
			// On a phone «Sorteos» is under «Más» in the tab bar.
			const draws = r.page.locator(`a[href="/campaigns/${campaign}/draws"]:visible`);
			if ((await draws.count()) === 0)
				await r.tap(r.page.getByRole('button', { name: 'Más' }), 'Más');
			await r.tap(draws.first(), 'Sorteos');
			await r.screen('Sorteos');
			await r.tap(r.page.locator('main a[href$="/draws/new"]').first(), 'Nuevo sorteo');
			await r.screen('Nuevo sorteo');
			await r.choose(r.page.locator('#drawType'), { value: 'monthly' }, 'Tipo de sorteo');
			await r.type(r.page.locator('#name'), 'Sorteo de diciembre', 'Nombre');
			await r.type(r.page.locator('#drawDate'), baDay(1), 'Fecha del sorteo');
			await r.type(r.page.locator('#paymentCutoffLocal'), `${baDay(0)}T23:59`, 'Fecha de corte');
			await r.type(r.page.locator('#requiredInstallmentNumber'), '1', 'Cuota requerida');
			await r.tap(r.page.getByRole('button', { name: 'Crear sorteo' }), 'Crear sorteo');
			await r.page.waitForURL(/\/draws\/[0-9a-f-]{36}$/);
			await r.screen('Sorteo programado');
			await r.tap(r.page.getByRole('button', { name: 'Generar padrón' }), 'Generar padrón');
			await r.page.getByText('Padrón generado.').waitFor();
			await r.screen('Padrón generado');
			await r.check(
				r.page.getByLabel('Confirmo que este padrón es el definitivo'),
				'Confirmar padrón definitivo'
			);
			await r.tap(r.page.getByRole('button', { name: 'Congelar padrón' }), 'Congelar padrón');
			await r.page.getByText('Padrón congelado.').waitFor();
			await r.screen('Padrón congelado');
			await r.tap(r.page.locator('main a[href$="/winners"]').first(), 'Ganadores y premios');
			await r.screen('Ganadores, sin premios');
			await r.tap(r.page.getByText('Configurar un premio'), 'Configurar un premio');
			await r.type(r.page.locator('#create-position'), '1', 'Puesto');
			await r.type(r.page.locator('#create-name'), 'Televisor', 'Nombre del premio');
			await r.tap(r.page.getByRole('button', { name: 'Crear premio' }), 'Crear premio');
			await r.page.getByText('Premio creado.').waitFor();
			await r.screen('Premio creado');
			await r.type(r.page.getByLabel('Número ganador'), String(eligibleNumber), 'Número ganador');
			await r.tap(
				r.page.getByRole('button', { name: 'Validar contra el padrón congelado' }),
				'Validar contra el padrón'
			);
			await r.page.getByText('Resultado de la validación').waitFor();
			await r.screen('Número validado');
			await r.tap(
				r.page.getByRole('button', { name: 'Registrar resolución' }),
				'Registrar resolución'
			);
			await r.page.getByText('Premio resuelto.').waitFor();
			await r.screen('Premio adjudicado');
		}
	},
	'portal-collect': {
		role: 'collector',
		run: async (r) => {
			await r.page.goto(`${BASE_URL}/portal`);
			// With one campaign in course the portal opens on «Por cobrar» (UX plan PR 10).
			const campaign = r.page.getByRole('link', { name: DEMO_CAMPAIGN_NAME });
			if (!/\/por-cobrar$/.test(new URL(r.page.url()).pathname) && (await campaign.count())) {
				await r.screen('Portal');
				await r.tap(campaign.first(), 'Elegir la campaña');
			}
			await r.screen('Por cobrar');
			await r.tap(r.page.getByRole('button', { name: /^Cobrar/ }).first(), 'Cobrar');
			await r.page.getByRole('dialog').waitFor();
			await r.screen('Hoja de cobro');
			await r.tap(
				r.page.getByRole('dialog').getByRole('button', { name: /^Enviar cobro/ }),
				'Enviar cobro'
			);
			await r.page.waitForURL(/enviado=1$/);
			await r.screen('Cobro enviado');
		}
	}
};

async function main() {
	const outDir = resolve(process.argv[2] ?? 'docs/ux/before/flows');
	const envPath = resolve(process.cwd(), '.env');
	if (existsSync(envPath)) process.loadEnvFile(envPath);
	const config = resolveSeedConfig();
	if (config.appEnv !== 'local') throw new Error('ux-flows only runs with APP_ENV=local.');
	const anonKey = process.env.PUBLIC_SUPABASE_ANON_KEY?.trim();
	if (!anonKey) throw new Error('PUBLIC_SUPABASE_ANON_KEY is required.');
	const options = { auth: { autoRefreshToken: false, persistSession: false } };
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
	const campaign = await admin
		.from('campaigns')
		.select('id')
		.eq('name', DEMO_CAMPAIGN_NAME)
		.single();
	if (campaign.error) throw new Error(`Demo campaign not found: ${campaign.error.message}`);
	const eligible = await admin
		.from('draw_roster_entries')
		.select('number_value, draw_rosters!inner(status, draws!inner(campaign_id))')
		.eq('eligible', true)
		.eq('draw_rosters.status', 'frozen')
		.eq('draw_rosters.draws.campaign_id', campaign.data.id)
		.order('number_value', { ascending: false })
		.limit(1);
	if (eligible.error || !eligible.data[0])
		throw new Error('No eligible number in a frozen roster.');

	const wanted = (process.env.UX_FLOWS ?? Object.keys(flows).join(',')).split(',');
	const collector = config.fixtures.find((user) => user.roleNames.includes('collector'))!;
	const browser = await chromium.launch();
	const unknown = wanted.filter((name) => !flows[name]);
	if (unknown.length) throw new Error(`Unknown flow: ${unknown.join(', ')}`);
	const { results, failed, exitCode } = await runEach(wanted, async (name) => {
		const flow = flows[name];
		const user = flow.role === 'admin' ? config.admin : collector;
		const page = await phone(browser, user.email, user.password);
		const recorder = new Recorder(name, page, join(outDir, name));
		let error: string | null = null;
		try {
			await flow.run(recorder, campaign.data.id, eligible.data[0].number_value as number);
		} catch (err) {
			error = (err as Error).message.split('\n')[0];
			recorder.failed = true;
			recorder.note(`FAILED: ${error}`);
			await recorder.screen('Fallo').catch(() => {});
			console.error(`${name} failed:`, error);
		}
		const summary = recorder.summary();
		console.log(
			`${name}: ${summary.screens} screens, ${summary.taps} taps, ${summary.fields} fields, ${summary.choices} choices`
		);
		await page.context().close();
		return { result: summary, error };
	});
	await browser.close();
	writeFileSync(join(outDir, 'flows.json'), `${JSON.stringify(results, null, '\t')}\n`);
	if (exitCode !== 0)
		console.error(
			`${failed.length} flow(s) failed: ${failed.join(', ')}. Their counts in flows.json are incomplete.`
		);
	return exitCode;
}

main()
	.then((exitCode) => process.exit(exitCode))
	.catch((err) => {
		console.error('ux-flows failed:', err);
		process.exit(1);
	});

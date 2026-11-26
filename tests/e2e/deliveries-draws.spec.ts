import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { apiActiveCampaign, apiBond, apiCollector, apiDeliverSellAndSettle, apiDraw } from './api';
import { STATE } from './auth-state';
import { open, runId } from './helpers';

/**
 * UX plan, PR 16 (audit A15). Deliveries: the added bonds are shown as ranges, each with its own
 * remove control, the button says how many bonds go to whom, and the note record leads with
 * «Imprimir». Draws: on every state the record answers «what now?» with one primary button, the
 * resolution of a prize names its outcome, and the roster is stacked rows on a phone.
 */
const baseURL = `http://127.0.0.1:${process.env.E2E_PORT ?? 4317}`;
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const SCREEN = 812;
/** 35 consecutive bonds, a gap of five numbers that do not exist, and one more bond. */
const FIRST = 300;
const LAST = 334;
const LONE = 340;
const WINNER = 100;

let campaignId: string;
let collector: string;
let noteId: string;
let drawId: string;
let untouchedDrawId: string;

const phoneContext = (browser: Browser, scheme: 'light' | 'dark') =>
	browser.newContext({
		baseURL,
		serviceWorkers: 'block',
		viewport: { width: 375, height: SCREEN },
		isMobile: true,
		hasTouch: true,
		colorScheme: scheme,
		storageState: STATE.admin,
		locale: 'es-AR',
		timezoneId: 'America/Argentina/Buenos_Aires'
	});

/** No sideways scroll, 44px targets (links inside a sentence are exempt) and a clean axe run. */
async function expectPhoneClean(page: Page, label: string) {
	const { overflow, small } = await page.evaluate(() => {
		const controls = [
			...document.querySelectorAll<HTMLElement>(
				'main button, main a[href], main input:not([type=hidden]), main select, main textarea, main summary'
			)
		];
		return {
			overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
			small: controls
				.filter((el) => {
					if (!el.getBoundingClientRect().width) return false;
					if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') return false;
					const input = el as HTMLInputElement;
					const target =
						input.type === 'checkbox' || input.type === 'radio' ? (el.closest('label') ?? el) : el;
					return target.getBoundingClientRect().height < 44;
				})
				.map(
					(el) =>
						`${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(el.getBoundingClientRect().height)}px`
				)
		};
	});
	expect(overflow, `${label}: the page does not scroll sideways`).toBeLessThanOrEqual(0);
	expect(small, `${label}: targets under 44px`).toEqual([]);
	const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
	expect(
		axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`),
		`${label}: axe`
	).toEqual([]);
}

/** The primary buttons and links in view: a screen has one. */
const primaries = (page: Page) =>
	page.locator('main a.bg-primary:visible, main button.bg-primary:visible');
const currentStep = (page: Page) => page.locator('[data-draw-steps] [aria-current="step"]');
const ranges = (page: Page) => page.locator('[data-delivery-ranges] [data-range]');

/** Adds the 35 bonds, the gap and the lone bond by range. */
async function addRange(page: Page) {
	await page.locator('#from').fill(String(FIRST));
	await page.locator('#to').fill(String(LONE));
	await page.getByRole('button', { name: 'Agregar' }).click();
	await expect(page.locator('[data-lookup-message]')).toHaveText(
		'36 bonos agregados. No están disponibles: 0335 a 0339.'
	);
}

test.describe.serial('deliveries and draws', () => {
	test.beforeAll(async () => {
		test.setTimeout(240_000);
		const run = runId();
		collector = `Cobrador ${run}`;
		campaignId = await apiActiveCampaign(`E2E entregas y sorteos ${run}`);
		const collectorId = await apiCollector(collector);
		for (let base = FIRST; base <= LAST; base++) await apiBond(campaignId, base);
		await apiBond(campaignId, LONE);
		// A sold, paid bond, so the draw has an eligible number.
		const sold = await apiBond(campaignId, WINNER);
		await apiDeliverSellAndSettle(campaignId, collectorId, sold);
		drawId = await apiDraw(campaignId, `Final ${run}`, 1);
		untouchedDrawId = await apiDraw(campaignId, `Otro ${run}`, 1);
	});

	for (const scheme of ['light', 'dark'] as const)
		test(`new delivery on a phone: 35 bonds are one range and the button is within 2 screens (${scheme})`, async ({
			browser
		}) => {
			const phone = await phoneContext(browser, scheme);
			const page = await phone.newPage();
			await open(page, `/campaigns/${campaignId}/deliveries/new`);
			// With nothing added the button says so and is not available.
			await expect(page.locator('[data-deliver-submit]')).toHaveText('Entregar bonos');
			await expect(page.locator('[data-deliver-submit]')).toBeDisabled();
			await expectPhoneClean(page, `empty delivery (${scheme})`);

			await addRange(page);
			await expect(ranges(page)).toHaveCount(2);
			await expect(ranges(page).nth(0)).toContainText('0300');
			await expect(ranges(page).nth(0)).toContainText('0334');
			await expect(ranges(page).nth(0)).toContainText('35 bonos');
			await expect(ranges(page).nth(1)).toContainText('0340');
			await expect(ranges(page).nth(1)).toContainText('1 bono');
			await expect(page.locator('[data-delivery-total]')).toContainText('36 bonos en esta entrega');
			// The range that was added is cleared, so the next number typed is not ignored.
			await expect(page.locator('#from')).toHaveValue('');
			await expect(page.locator('#to')).toHaveValue('');

			// One remove control per range: it takes its bonds out of what is posted.
			await page.getByRole('button', { name: 'Quitar el bono 0340' }).click();
			await expect(ranges(page)).toHaveCount(1);
			await expect(page.locator('#deliver-form input[name="bondIds"]')).toHaveCount(35);

			await page.locator('#collectorId').selectOption({ label: collector });
			const submit = page.locator('[data-deliver-submit]');
			await expect(submit).toHaveText(`Entregar 35 bonos a ${collector}`);
			await expect(submit).toBeEnabled();
			const bottom = await submit.evaluate(
				(el) => el.getBoundingClientRect().bottom + window.scrollY
			);
			expect(bottom, 'the submit button is within 2 screens').toBeLessThanOrEqual(2 * SCREEN);
			await expectPhoneClean(page, `delivery with a range (${scheme})`);
			await phone.close();
		});

	test('delivering the range issues the note, whose action is «Imprimir»', async ({ page }) => {
		await open(page, `/campaigns/${campaignId}/deliveries/new`);
		await page.locator('#collectorId').selectOption({ label: collector });
		await addRange(page);
		// A number that is already in the list is not added twice.
		await page.locator('#query').fill(String(LONE));
		await page.locator('#query').press('Enter');
		await expect(page.locator('[data-lookup-message]')).toHaveText('Ya está en la lista.');
		await page.getByRole('button', { name: 'Quitar el bono 0340' }).click();
		await expect(primaries(page)).toHaveCount(1);
		await page.getByRole('button', { name: `Entregar 35 bonos a ${collector}` }).click();
		await expect(page).toHaveURL(/\/deliveries\/[0-9a-f-]{36}$/);
		noteId = page.url().split('/').pop()!;

		await expect(page.locator('[data-note-sentence]')).toContainText(
			`Se entregaron 35 bonos a ${collector} el`
		);
		await expect(page.locator('[data-note-ranges] [data-range]')).toHaveCount(1);
		await expect(page.locator('[data-note-ranges] [data-range]')).toContainText('35 bonos');
		const print = page.getByRole('link', { name: 'Imprimir', exact: true });
		await expect(print).toHaveAttribute('href', new RegExp(`/deliveries/${noteId}/print$`));
		await expect(primaries(page)).toHaveCount(1);
		await expect(primaries(page)).toHaveText('Imprimir');
		// Every bond is one tap away, under the ranges.
		await page.getByText('Abrir la ficha de un bono').click();
		await expect(page.locator('[data-note-bonds] a')).toHaveCount(35);
		await expect(page.locator('[data-note-bonds] a').first()).toHaveAttribute(
			'href',
			/\/bonds\/[0-9a-f-]{36}$/
		);
		// The lone bond was not delivered: it is still available.
		await open(page, `/campaigns/${campaignId}/deliveries/new`);
		await page.locator('#query').fill(String(LONE));
		await page.locator('#query').press('Enter');
		await expect(page.locator('[data-lookup-message]')).toHaveText('1 bono agregado.');
		await page.locator('#query').fill(String(FIRST));
		await page.locator('#query').press('Enter');
		await expect(page.locator('[data-lookup-message]')).toHaveText(
			'Ningún bono disponible coincide.'
		);
	});

	test('a draw answers «what now?» with one button on each state', async ({ page }) => {
		test.setTimeout(180_000);
		const draw = `/campaigns/${campaignId}/draws/${drawId}`;
		await open(page, draw);
		// Scheduled: generate the roster.
		await expect(currentStep(page)).toHaveAttribute('data-step', 'generate');
		await expect(primaries(page)).toHaveCount(1);
		await expect(primaries(page)).toHaveText('Generar padrón');
		await page.getByRole('button', { name: 'Generar padrón' }).click();
		await expect(page.getByText('Padrón generado.')).toBeVisible();
		await page.waitForLoadState('networkidle');

		// Generated: freeze it. The step says it is definitive and asks for the confirmation.
		await expect(currentStep(page)).toHaveAttribute('data-step', 'freeze');
		await expect(page.locator('[data-step="generate"]')).toContainText('Generado el');
		await expect(currentStep(page)).toContainText('Congelar es definitivo');
		await expect(primaries(page)).toHaveCount(1);
		await expect(primaries(page)).toHaveText('Congelar padrón');
		await expect(page.getByRole('button', { name: 'Regenerar padrón' })).toBeVisible();
		await page.getByLabel('Confirmo que este padrón es el definitivo').check();
		await page.getByRole('button', { name: 'Congelar padrón' }).click();
		await expect(page.getByText('Padrón congelado.')).toBeVisible();
		await page.waitForLoadState('networkidle');

		// Frozen, no prizes: load the winners. The roster leads there too.
		await expect(currentStep(page)).toHaveAttribute('data-step', 'winners');
		await expect(page.locator('[data-step="freeze"]')).toContainText('Congelado el');
		await expect(primaries(page)).toHaveCount(1);
		await expect(primaries(page)).toHaveText('Cargar ganadores');
		await expect(page.locator('form[action="?/complete"]')).toHaveCount(0);
		await page.getByRole('link', { name: 'Ver padrón' }).click();
		await expect(page.getByRole('heading', { name: 'Padrón congelado', level: 1 })).toBeVisible();
		await expect(page.getByRole('row', { name: /0100.*Habilitado/ })).toBeVisible();
		await page.getByRole('link', { name: 'Cargar ganadores' }).click();
		await expect(page).toHaveURL(/\/winners$/);
		await page.waitForLoadState('networkidle');

		// No prizes yet: the form of the first prize is open and is the primary action.
		await expect(page.locator('#create-name')).toBeVisible();
		await expect(primaries(page)).toHaveText('Crear premio');
		await page.locator('#create-position').fill('1');
		await page.locator('#create-name').fill('Bicicleta');
		await page.getByRole('button', { name: 'Crear premio' }).click();
		await expect(page.getByText('Premio creado.')).toBeVisible();
		await page.waitForLoadState('networkidle');
		await expect(page.locator('#create-name')).toBeHidden();
		await expect(primaries(page)).toHaveText('Validar contra el padrón congelado');
		await page.getByLabel('Número ganador').fill(String(WINNER));
		await page.getByRole('button', { name: 'Validar contra el padrón congelado' }).click();
		await expect(page.getByText('Resultado de la validación del 0100')).toBeVisible();
		await page.waitForLoadState('networkidle');

		// The resolution names its outcome and says it cannot be changed.
		await expect(page.getByRole('button', { name: 'Registrar resolución' })).toHaveCount(0);
		await expect(page.locator('[data-resolution-note]')).toContainText(
			'La resolución no se puede cambiar'
		);
		await expect(primaries(page)).toHaveText('Adjudicar el premio');
		// Leaving it unawarded is asked in a dialog; cancelling changes nothing.
		await page.getByRole('button', { name: 'Dejar sin adjudicar' }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toContainText('¿Dejar sin adjudicar el premio 1, Bicicleta?');
		await expect(dialog).toContainText('El número 0100 está habilitado');
		await dialog.getByRole('button', { name: 'Cancelar' }).click();
		await expect(dialog).toBeHidden();
		await page.getByRole('button', { name: 'Adjudicar el premio' }).click();
		await expect(page.getByText('Premio resuelto.')).toBeVisible();
		await expect(page.getByText('Pendiente de entrega').first()).toBeVisible();
		await page.waitForLoadState('networkidle');

		// Every prize resolved: the page leads back to the draw, whose next step is completing it.
		await page
			.locator('[data-next-step]')
			.getByRole('link', { name: 'Ir a completar el sorteo' })
			.click();
		await expect(page).toHaveURL(new RegExp(`/draws/${drawId}$`));
		await page.waitForLoadState('networkidle');
		await expect(currentStep(page)).toHaveAttribute('data-step', 'complete');
		await expect(page.locator('[data-step="winners"]')).toContainText(
			'1 premio resuelto. Falta entregar 1.'
		);
		await expect(primaries(page)).toHaveCount(1);
		await expect(primaries(page)).toHaveText('Completar sorteo');
		await page.getByRole('button', { name: 'Completar sorteo' }).click();
		await expect(page.getByText('Realizado').first()).toBeVisible();
		await page.waitForLoadState('networkidle');

		// Completed: no step is pending; what is left is handing the prize over.
		await expect(currentStep(page)).toHaveCount(0);
		await expect(primaries(page)).toHaveCount(1);
		await expect(primaries(page)).toHaveText('Registrar la entrega del premio');
	});

	for (const scheme of ['light', 'dark'] as const)
		test(`the note, the draw, the roster and the winners on a phone (${scheme})`, async ({
			browser
		}) => {
			test.setTimeout(120_000);
			const phone = await phoneContext(browser, scheme);
			const page = await phone.newPage();
			const campaign = `/campaigns/${campaignId}`;

			await open(page, `${campaign}/deliveries/${noteId}`);
			const print = await page.getByRole('link', { name: 'Imprimir', exact: true }).boundingBox();
			expect(print!.y + print!.height, '«Imprimir» is in the first screen').toBeLessThan(SCREEN);
			await expectPhoneClean(page, `delivery note (${scheme})`);

			await open(page, `${campaign}/draws/${untouchedDrawId}`);
			const generate = await page.getByRole('button', { name: 'Generar padrón' }).boundingBox();
			expect(generate!.y + generate!.height, 'the next step is in the first screen').toBeLessThan(
				SCREEN
			);
			await expectPhoneClean(page, `scheduled draw (${scheme})`);

			await open(page, `${campaign}/draws/${drawId}`);
			await expectPhoneClean(page, `completed draw (${scheme})`);

			// The roster is stacked rows: the number, its eligibility, and who under them.
			await open(page, `${campaign}/draws/${drawId}/roster`);
			const row = page.getByRole('row', { name: /0100.*Habilitado/ });
			await expect(row).toBeVisible();
			await expect(row).toContainText(`lo cobra ${collector}`);
			const box = await row.boundingBox();
			expect(box!.x + box!.width, 'a roster row fits the screen').toBeLessThanOrEqual(375);
			await expectPhoneClean(page, `roster (${scheme})`);

			await open(page, `${campaign}/draws/${drawId}/winners`);
			await expect(page.getByRole('button', { name: 'Registrar entrega' })).toBeVisible();
			await expectPhoneClean(page, `winners (${scheme})`);
			await phone.close();
		});
});

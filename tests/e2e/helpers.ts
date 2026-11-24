import { expect, type Page } from '@playwright/test';

export const ADMIN = {
	email: process.env.INITIAL_ADMIN_EMAIL ?? 'admin@firefighters.local',
	password: process.env.INITIAL_ADMIN_PASSWORD ?? 'Admin123456!'
};

/** Unique suffix so every run creates its own campaign and parties. */
export const runId = () => `${Date.now()}`.slice(-7);

/** Navigates and waits for hydration, so filled values are not reset by Svelte bindings. */
export async function open(page: Page, url: string) {
	await page.goto(url);
	await page.waitForLoadState('networkidle');
}

export async function login(page: Page, user = ADMIN) {
	await open(page, '/login');
	await page.getByLabel('Correo electrónico').fill(user.email);
	await page.getByLabel('Contraseña').fill(user.password);
	await page.getByRole('button', { name: /ingresar|iniciar sesión/i }).click();
	await expect(page).not.toHaveURL(/\/login/);
}

/** Calendar day in Buenos Aires, offset by `days`, as YYYY-MM-DD. */
export function baDay(days = 0) {
	const now = new Date(Date.now() + days * 86_400_000);
	return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(
		now
	);
}

/** Creates and activates a one-installment campaign; returns its id. */
export async function createActiveCampaign(page: Page, name: string) {
	await open(page, '/campaigns/new');
	await page.locator('#name').fill(name);
	await page.locator('#startsOn').fill(baDay(-1));
	await page.locator('#endsOn').fill(baDay(60));
	await page.locator('#simpleBondValue').fill('1000');
	await page.locator('#installmentCount').fill('1');
	await page.locator('#numberDigits').fill('4');
	await page.locator('#maxNumber').fill('9999');
	await page.locator('#associatedNumberOffset').fill('5000');
	await page.locator('#barcodeMode').selectOption('base_number');
	await page.getByRole('button', { name: 'Crear campaña' }).click();
	await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/);
	const id = page.url().split('/').pop()!;
	await page.getByRole('button', { name: 'Activar', exact: true }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Activar campaña' }).click();
	await expect(page.getByText('Activa', { exact: true }).first()).toBeVisible();
	return id;
}

export async function createCollector(page: Page, campaignId: string, name: string) {
	await open(page, `/campaigns/${campaignId}/collectors/new`);
	await page.locator('#displayName').fill(name);
	await page.locator('form:has(#displayName) button:not([type="button"])').click();
	await expect(page).not.toHaveURL(/collectors\/new/);
}

export async function createBond(page: Page, campaignId: string, base: number) {
	await open(page, `/campaigns/${campaignId}/bonds/new`);
	await page.locator('#baseNumber').fill(String(base));
	await page.locator('button[type="submit"][value="save"]').click();
	await expect(page).toHaveURL(/\/bonds\/[0-9a-f-]{36}$/);
}

/**
 * Delivers bond `base` to `collector`, sells it (full payment) to a buyer created inline, records the
 * cash payment in a new settlement and closes it. Shared by both critical flows.
 */
export async function deliverSellAndSettle(
	page: Page,
	campaignId: string,
	collector: string,
	base: number
) {
	// Deliver the bond to the collector.
	await open(page, `/campaigns/${campaignId}/deliveries/new`);
	await page.locator('#query').fill(String(base));
	await page.getByRole('button', { name: 'Agregar' }).click();
	await expect(page.getByText('1 agregados.')).toBeVisible();
	await page.locator('#collectorId').selectOption({ label: collector });
	await page.getByRole('button', { name: 'Entregar y emitir remito' }).click();
	await expect(page).toHaveURL(/\/deliveries\/[0-9a-f-]{36}$/);
	const noteId = page.url().split('/').pop()!;
	await expect(page.getByRole('heading', { name: /Remito \d{4}/ })).toBeVisible();

	// Sell it to a buyer created inline.
	await open(page, `/campaigns/${campaignId}/sales/new`);
	await page.locator('#query').fill(String(base));
	await page.locator('form[action="?/lookup"] button[type="submit"]').click();
	await page.getByRole('radio').first().check();
	await page.getByText('Crear un comprador').click();
	await page.locator('#buyer-firstName').fill('Ana');
	await page.locator('#buyer-lastName').fill(`Comprador ${collector}`);
	await page.getByRole('button', { name: 'Crear comprador' }).click();
	await expect(page.locator('#buyerId')).not.toHaveValue('');
	await page.getByRole('button', { name: 'Confirmar venta' }).click();
	await expect(page).toHaveURL(/\/sales\/[0-9a-f-]{36}$/);
	const saleId = page.url().split('/').pop()!;
	await expect(page.getByText('Pago total').first()).toBeVisible();

	// Open a settlement, add the cash payment and close it.
	await open(page, `/campaigns/${campaignId}/settlements/new`);
	await page.locator('#collectorId').selectOption({ label: collector });
	await page.getByRole('button', { name: 'Abrir rendición' }).click();
	await expect(page).toHaveURL(/\/settlements\/[0-9a-f-]{36}$/);
	const settlementId = page.url().split('/').pop()!;
	await page.waitForLoadState('networkidle');
	await page.locator('#sale').selectOption({ index: 1 });
	await page.locator('input[name="installmentId"]').first().check();
	await page.getByRole('button', { name: 'Agregar pago' }).click();
	await expect(page.getByText('Pago agregado.')).toBeVisible();
	await page.getByRole('button', { name: 'Cerrar rendición' }).first().click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByText('$ 1.000,00').first()).toBeVisible();
	await dialog.getByRole('button', { name: 'Cerrar rendición' }).click();
	await expect(page.getByText('Rendición cerrada.')).toBeVisible();
	await expect(page.getByText('Cerrada', { exact: true }).first()).toBeVisible();
	return { noteId, saleId, settlementId };
}

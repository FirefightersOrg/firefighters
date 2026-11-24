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

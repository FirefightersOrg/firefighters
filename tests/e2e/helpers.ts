import { expect, type Page } from '@playwright/test';

export const ADMIN = {
	email: process.env.INITIAL_ADMIN_EMAIL ?? 'admin@firefighters.local',
	password: process.env.INITIAL_ADMIN_PASSWORD ?? 'Admin123456!'
};

/** Unique suffix so every run creates its own campaign and parties. */
export const runId = () => `${Date.now()}`.slice(-7);

export async function login(page: Page, user = ADMIN) {
	await page.goto('/login');
	await page.getByLabel('Correo electrónico').fill(user.email);
	await page.getByLabel('Contraseña').fill(user.password);
	await page.getByRole('button', { name: /ingresar|iniciar sesión/i }).click();
	await expect(page).not.toHaveURL(/\/login/);
}

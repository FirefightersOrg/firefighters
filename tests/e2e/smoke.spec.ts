import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('admin signs in and reaches the campaigns list', async ({ page }) => {
	await login(page);
	await page.goto('/campaigns');
	await expect(page.getByRole('heading', { name: 'Campañas', level: 1 })).toBeVisible();
});

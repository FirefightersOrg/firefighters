import { expect, test } from '@playwright/test';
import { ANONYMOUS } from './auth-state';
import { login } from './helpers';

// Signs in through the UI itself, so it starts without the saved admin session.
test.use({ storageState: ANONYMOUS });

test('admin signs in and reaches the campaigns list', async ({ page }) => {
	await login(page);
	await page.goto('/campaigns');
	await expect(page.getByRole('heading', { name: 'Campañas', level: 1 })).toBeVisible();
});

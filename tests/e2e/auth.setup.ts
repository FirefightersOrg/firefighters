import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { test as setup } from '@playwright/test';
import { ROLES, STATE, type Role } from './auth-state';
import { login } from './helpers';

/**
 * Global setup project (SAN-166): signs in ONCE per role through the real login form and saves the
 * session as a `storageState` file, so no other test pays for a login. The default project reuses
 * the admin file; a spec that needs another role calls `test.use({ storageState: STATE.collector })`.
 * The login flow itself stays covered through the UI by `smoke.spec.ts` and the login-page checks.
 */
for (const role of Object.keys(ROLES) as Role[])
	setup(`sign in as ${role}`, async ({ page }) => {
		mkdirSync(dirname(STATE[role]), { recursive: true });
		await login(page, ROLES[role]);
		await page.context().storageState({ path: STATE[role] });
	});

import { defineConfig, devices } from '@playwright/test';

/**
 * Critical E2E flows (SAN-91, docs/technical-design.md). They run against the local Supabase stack
 * (reset + seed:admin first) and a dev server started by Playwright. Run with `pnpm test:e2e`, which
 * takes the shared local-DB lock like the integration suite.
 */
const port = Number(process.env.E2E_PORT ?? 4317);
export default defineConfig({
	testDir: 'tests/e2e',
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 120_000,
	expect: { timeout: 15_000 },
	reporter: [['list']],
	use: {
		baseURL: `http://127.0.0.1:${port}`,
		locale: 'es-AR',
		timezoneId: 'America/Argentina/Buenos_Aires',
		trace: 'retain-on-failure',
		...devices['Desktop Chrome']
	},
	webServer: {
		command: `pnpm exec vite dev --host 127.0.0.1 --port ${port} --strictPort`,
		url: `http://127.0.0.1:${port}/login`,
		reuseExistingServer: false,
		timeout: 120_000,
		env: {
			PUBLIC_SUPABASE_URL: process.env.PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
			PUBLIC_SUPABASE_ANON_KEY: process.env.PUBLIC_SUPABASE_ANON_KEY ?? '',
			SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
			APP_ENV: 'local',
			PUBLIC_INSTITUTION_NAME: 'Bomberos Voluntarios'
		}
	}
});

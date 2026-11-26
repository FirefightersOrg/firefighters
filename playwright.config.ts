import { defineConfig, devices } from '@playwright/test';

/**
 * Critical E2E flows (SAN-91, docs/technical-design.md). They run against the local Supabase stack
 * (reset + seed:admin first) and a server started by Playwright. Run with `pnpm test:e2e`, which
 * takes a DB slot like the integration suite.
 *
 * The server is a PRODUCTION build (`vite build` + `vite preview`, SAN-166): pages are served as
 * shipped and respond faster than the dev server. Set `E2E_DEV=1` to use `vite dev` instead (no
 * build wait, hot reload) when debugging. Env vars reach the built app at run time (every `$env`
 * import is dynamic), so the same values are given to the build and to the preview.
 */
const port = Number(process.env.E2E_PORT ?? 4317);
const dev = process.env.E2E_DEV === '1';
const host = `--host 127.0.0.1 --port ${port} --strictPort`;
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
		// The service worker (PWA, covered by `pnpm test:pwa`) must not cache or intercept pages here.
		serviceWorkers: 'block',
		...devices['Desktop Chrome']
	},
	webServer: {
		command: dev
			? `pnpm exec vite dev ${host}`
			: `pnpm exec vite build && pnpm exec vite preview ${host}`,
		url: `http://127.0.0.1:${port}/login`,
		reuseExistingServer: false,
		timeout: 300_000,
		env: {
			PUBLIC_SUPABASE_URL: process.env.PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
			PUBLIC_SUPABASE_ANON_KEY: process.env.PUBLIC_SUPABASE_ANON_KEY ?? '',
			SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
			APP_ENV: 'local',
			PUBLIC_INSTITUTION_NAME: 'Bomberos Voluntarios'
		}
	}
});

import { defineConfig, devices } from '@playwright/test';

/**
 * PWA checks (SAN-92) against a PRODUCTION build: the service worker, the precache and the offline
 * fallback only behave as shipped in `vite build` + `vite preview`, not in the dev server.
 * Run with `pnpm test:pwa`. No database is needed: only public pages are visited.
 */
const port = Number(process.env.PWA_PORT ?? 4318);
const env = {
	PUBLIC_SUPABASE_URL: process.env.PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
	PUBLIC_SUPABASE_ANON_KEY: process.env.PUBLIC_SUPABASE_ANON_KEY ?? 'anon',
	SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'service',
	APP_ENV: 'local',
	PUBLIC_INSTITUTION_NAME: 'Bomberos Voluntarios'
};
export default defineConfig({
	testDir: 'tests/pwa',
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 120_000,
	expect: { timeout: 15_000 },
	reporter: [['list']],
	use: {
		baseURL: `http://127.0.0.1:${port}`,
		locale: 'es-AR',
		trace: 'retain-on-failure',
		...devices['Desktop Chrome']
	},
	webServer: {
		command: `pnpm exec vite build && pnpm exec vite preview --host 127.0.0.1 --port ${port} --strictPort`,
		url: `http://127.0.0.1:${port}/login`,
		reuseExistingServer: false,
		timeout: 300_000,
		env
	}
});

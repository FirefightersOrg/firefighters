import { defineConfig } from 'vitest/config';
import baseConfig from './vite.config';

/**
 * Live-Supabase integration suite (`pnpm test:integration`), kept out of `pnpm test`.
 *
 * Reuses vite.config.ts (sveltekit plugin, so $lib / $env / $app resolve as in the app) and only
 * swaps the test selection. The global setup refuses to run unless the target is a local
 * Supabase (localhost/127.0.0.1 and APP_ENV=local); see tests/integration/local-env.ts.
 */
export default defineConfig({
	...baseConfig,
	test: {
		...baseConfig.test,
		include: ['tests/integration/**/*.test.ts'],
		globalSetup: ['tests/integration/global-setup.ts'],
		// The suite creates and deletes real users; run files one at a time.
		fileParallelism: false,
		testTimeout: 30_000,
		hookTimeout: 30_000
	}
});

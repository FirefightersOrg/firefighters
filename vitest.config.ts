import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}', 'scripts/**/*.{test,spec}.{js,ts}'],
		environment: 'node'
	},
	resolve: {
		alias: {
			$lib: path.resolve('./src/lib'),
			'$env/dynamic/private': path.resolve('./tests/mocks/env.ts'),
			'$env/dynamic/public': path.resolve('./tests/mocks/env.ts'),
			'$env/static/private': path.resolve('./tests/mocks/env.ts'),
			'$env/static/public': path.resolve('./tests/mocks/env.ts')
		}
	}
});

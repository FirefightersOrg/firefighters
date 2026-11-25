import adapter from '@sveltejs/adapter-auto';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
			// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
			// See https://svelte.dev/docs/kit/adapters for more information about adapters.
			adapter: adapter()
		})
	],
	// Agent worktrees live under .claude/worktrees inside the repo; their builds must not
	// trigger reloads in the main dev server.
	server: {
		watch: { ignored: ['**/.claude/**'] }
	},
	// Vitest reads this file (no separate vitest.config.ts) so the sveltekit() plugin
	// resolves $lib, $env/* and $app/* in tests exactly as in the app.
	// Unit tests only: `pnpm test` must not need Supabase or the network. The live-Supabase
	// suite in tests/integration runs via `pnpm test:integration` (vitest.integration.config.ts).
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}', 'scripts/**/*.{test,spec}.{js,ts}'],
		environment: 'node'
	}
});

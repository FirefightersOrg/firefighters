import type { TestProject } from 'vitest/node';
import { resolveIntegrationEnv, type IntegrationEnv } from './local-env';

declare module 'vitest' {
	export interface ProvidedContext {
		integrationEnv: IntegrationEnv;
	}
}

/**
 * Runs once before any integration test file. Fails the whole run (before any request is made)
 * when the target is not a local Supabase, and hands the resolved env to the test workers.
 */
export default function setup(project: TestProject) {
	const integrationEnv = resolveIntegrationEnv();
	console.log(`[integration] target: ${integrationEnv.supabaseUrl} (APP_ENV=local)`);
	project.provide('integrationEnv', integrationEnv);
}

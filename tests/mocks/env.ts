import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load .env if present and environment variables are not pre-set
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
	const content = readFileSync(envPath, 'utf-8');
	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eqIndex = trimmed.indexOf('=');
		if (eqIndex !== -1) {
			const key = trimmed.slice(0, eqIndex).trim();
			const val = trimmed.slice(eqIndex + 1).trim();
			if (!process.env[key]) {
				process.env[key] = val;
			}
		}
	}
}

export const env = {
	PUBLIC_SUPABASE_URL: process.env.PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321',
	PUBLIC_SUPABASE_ANON_KEY: process.env.PUBLIC_SUPABASE_ANON_KEY || 'test-anon-key',
	SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key',
	APP_ENV: process.env.APP_ENV || 'local',
	...process.env
};

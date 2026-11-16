import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

/**
 * Single source of configuration for the integration suite. The test's own Supabase clients and
 * the `$env/dynamic/*` modules seen by route code under test are both built from this object, so
 * they can never use different credentials.
 */
export interface IntegrationEnv {
	supabaseUrl: string;
	anonKey: string;
	serviceRoleKey: string;
	/** Raw variables used to resolve the seeded admin/fixture credentials (`resolveSeedConfig`). */
	seedEnv: Record<string, string | undefined>;
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

const SEED_KEYS = [
	'INITIAL_ADMIN_EMAIL',
	'INITIAL_ADMIN_PASSWORD',
	'INITIAL_ADMIN_NAME',
	'TEST_USER_PASSWORD'
] as const;

function refuse(reason: string): never {
	throw new Error(
		`Refusing to run the integration suite: ${reason}\n` +
			'It creates real users and permanent audit_log rows, so it only runs against a local ' +
			'Supabase (`supabase start`) with APP_ENV=local and PUBLIC_SUPABASE_URL on ' +
			'localhost/127.0.0.1.'
	);
}

function readEnvFile(cwd: string): Record<string, string | undefined> {
	const path = resolve(cwd, '.env');
	return existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {};
}

/** Keys of the running local stack (`supabase status -o env`), or {} if the CLI fails. */
function readSupabaseStatus(cwd: string): Record<string, string | undefined> {
	try {
		const output = execFileSync('supabase', ['status', '-o', 'env'], {
			cwd,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore']
		});
		return parseEnv(output);
	} catch {
		return {};
	}
}

function nonEmpty(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

/**
 * Resolves the integration environment and enforces the local-only guard.
 *
 * Precedence: shell environment, then `.env`, then (only for values still missing) the running
 * local stack via `supabase status -o env`. Throws unless APP_ENV is exactly 'local' and the
 * Supabase URL host is localhost/127.0.0.1.
 */
export function resolveIntegrationEnv(
	processEnv: Record<string, string | undefined> = process.env,
	cwd: string = process.cwd()
): IntegrationEnv {
	const env: Record<string, string | undefined> = { ...readEnvFile(cwd), ...processEnv };

	const appEnv = nonEmpty(env.APP_ENV);
	if (appEnv !== 'local') {
		refuse(`APP_ENV must be 'local' (got ${appEnv ? `'${appEnv}'` : '<unset>'}).`);
	}

	let status: Record<string, string | undefined> | null = null;
	const fromStatus = (key: string) => {
		status ??= readSupabaseStatus(cwd);
		return nonEmpty(status[key]);
	};

	const supabaseUrl = nonEmpty(env.PUBLIC_SUPABASE_URL) ?? fromStatus('API_URL');
	if (!supabaseUrl) {
		refuse('PUBLIC_SUPABASE_URL is unset and `supabase status` reported no API_URL.');
	}

	let hostname: string;
	try {
		hostname = new URL(supabaseUrl).hostname;
	} catch {
		refuse(`PUBLIC_SUPABASE_URL is not a valid URL (${supabaseUrl}).`);
	}
	if (!LOCAL_HOSTNAMES.has(hostname)) {
		refuse(`PUBLIC_SUPABASE_URL host '${hostname}' is not localhost/127.0.0.1.`);
	}

	const anonKey = nonEmpty(env.PUBLIC_SUPABASE_ANON_KEY) ?? fromStatus('ANON_KEY');
	const serviceRoleKey = nonEmpty(env.SUPABASE_SERVICE_ROLE_KEY) ?? fromStatus('SERVICE_ROLE_KEY');
	if (!anonKey || !serviceRoleKey) {
		throw new Error(
			'Integration suite: PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are not set and ' +
				'could not be read from `supabase status -o env`. Is local Supabase running?'
		);
	}

	const seedEnv: Record<string, string | undefined> = {
		APP_ENV: 'local',
		PUBLIC_SUPABASE_URL: supabaseUrl
	};
	for (const key of SEED_KEYS) seedEnv[key] = env[key];

	return { supabaseUrl, anonKey, serviceRoleKey, seedEnv };
}

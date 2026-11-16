import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import {
	createAdminManagedUser,
	grantRoles,
	provisionProfile
} from '../src/lib/server/services/user-admin';

/**
 * Seeds (and repairs) the initial administrator and, in local development only, one fixture
 * user per non-admin role.
 *
 * Safety:
 * - Fixture users and default passwords are used ONLY when `APP_ENV=local` is set explicitly
 *   AND `PUBLIC_SUPABASE_URL` points at localhost / 127.0.0.1.
 * - Outside local, `PUBLIC_SUPABASE_URL`, `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD`
 *   are required; there are no fallbacks.
 *
 * Idempotency: for each seeded user it checks the profile and its roles and repairs what is
 * missing (auth user without profile, profile without the expected role). Passwords of existing
 * users are never changed.
 */

const LOCAL_DEFAULTS = {
	supabaseUrl: 'http://127.0.0.1:54321',
	adminEmail: 'admin@firefighters.local',
	adminPassword: 'Admin123456!',
	fixturePassword: 'LocalDev123456!'
} as const;

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

const FIXTURE_USERS = [
	{ email: 'operator@firefighters.local', fullName: 'Test Operator', roleNames: ['operator'] },
	{ email: 'treasurer@firefighters.local', fullName: 'Test Treasurer', roleNames: ['treasurer'] },
	{ email: 'collector@firefighters.local', fullName: 'Test Collector', roleNames: ['collector'] },
	{ email: 'readonly@firefighters.local', fullName: 'Test Read Only', roleNames: ['read-only'] }
] as const;

type Env = Record<string, string | undefined>;

export interface SeedUser {
	email: string;
	password: string;
	fullName: string;
	roleNames: string[];
}

export interface SeedConfig {
	appEnv: string | null;
	supabaseUrl: string;
	serviceRoleKey: string | null;
	admin: SeedUser;
	fixtures: SeedUser[];
}

function read(env: Env, key: string): string | undefined {
	const value = env[key]?.trim();
	return value ? value : undefined;
}

function isLocalUrl(url: string): boolean {
	try {
		return LOCAL_HOSTNAMES.has(new URL(url).hostname);
	} catch {
		return false;
	}
}

/**
 * Resolves and validates the seed configuration from environment variables.
 * Throws with an actionable message when a required value is missing or the setup is unsafe.
 */
export function resolveSeedConfig(env: Env = process.env): SeedConfig {
	const appEnv = read(env, 'APP_ENV') ?? null;
	const isLocal = appEnv === 'local';

	const requireValue = (key: string, localDefault: string): string => {
		const value = read(env, key);
		if (value) return value;
		if (isLocal) return localDefault;
		throw new Error(
			`${key} is required when APP_ENV is not 'local' (APP_ENV=${appEnv ?? '<unset>'}).`
		);
	};

	const supabaseUrl = requireValue('PUBLIC_SUPABASE_URL', LOCAL_DEFAULTS.supabaseUrl);
	if (isLocal && !isLocalUrl(supabaseUrl)) {
		throw new Error(
			`APP_ENV=local but PUBLIC_SUPABASE_URL (${supabaseUrl}) is not localhost/127.0.0.1. ` +
				'Refusing to seed fixture users and default passwords into a non-local project. ' +
				'Set APP_ENV to the real environment name and provide INITIAL_ADMIN_* explicitly.'
		);
	}

	const admin: SeedUser = {
		email: requireValue('INITIAL_ADMIN_EMAIL', LOCAL_DEFAULTS.adminEmail).toLowerCase(),
		password: requireValue('INITIAL_ADMIN_PASSWORD', LOCAL_DEFAULTS.adminPassword),
		fullName: read(env, 'INITIAL_ADMIN_NAME') ?? 'System Administrator',
		roleNames: ['admin']
	};

	const fixturePassword = read(env, 'TEST_USER_PASSWORD') ?? LOCAL_DEFAULTS.fixturePassword;
	const fixtures: SeedUser[] = isLocal
		? FIXTURE_USERS.map((u) => ({ ...u, roleNames: [...u.roleNames], password: fixturePassword }))
		: [];

	return {
		appEnv,
		supabaseUrl,
		serviceRoleKey: read(env, 'SUPABASE_SERVICE_ROLE_KEY') ?? null,
		admin,
		fixtures
	};
}

/**
 * Finds an auth user by email, paging through `auth.admin.listUsers()` (it returns one page,
 * 50 users by default). Throws on API errors.
 */
export async function findAuthUserByEmail(
	adminClient: SupabaseClient,
	email: string,
	perPage = 1000
): Promise<User | null> {
	const normalizedEmail = email.toLowerCase().trim();

	for (let page = 1; ; page++) {
		const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
		if (error) {
			throw new Error(`Failed to list auth users (page ${page}): ${error.message}`);
		}

		const users = data?.users ?? [];
		const match = users.find((u) => u.email?.toLowerCase() === normalizedEmail);
		if (match) return match;
		if (users.length < perPage) return null;
	}
}

export type EnsureUserOutcome = 'created' | 'existing' | 'repaired';

/**
 * Makes sure `user` exists with an active-or-inactive profile and holds `user.roleNames`.
 * - No auth user: creates it (auth user + profile + roles + audit).
 * - Auth user without profile (e.g. failed compensation): provisions the profile.
 * - Profile missing a role: grants it.
 * Existing passwords and profile status are not changed (an inactive user is reported).
 */
export async function ensureUser(
	adminClient: SupabaseClient,
	user: SeedUser,
	requestId: string
): Promise<EnsureUserOutcome> {
	const email = user.email.toLowerCase().trim();

	const { data: profile, error: profileError } = await adminClient
		.from('profiles')
		.select('id, status')
		.eq('email', email)
		.maybeSingle();
	if (profileError) {
		throw new Error(`Failed to look up profile for ${email}: ${profileError.message}`);
	}

	if (profile) {
		const granted = await grantRoles(adminClient, {
			profileId: profile.id,
			roleNames: user.roleNames,
			actorUserId: null,
			requestId,
			reason: 'Seed repair: missing role assignment'
		});
		if (profile.status !== 'active') {
			console.warn(
				`  ${email} exists but its profile is '${profile.status}'. Not reactivating it; ` +
					'reactivate it manually if intended.'
			);
		}
		if (granted.length > 0) {
			console.log(`  ${email}: granted missing role(s) ${granted.join(', ')}`);
			return 'repaired';
		}
		console.log(`  ${email}: already provisioned`);
		return 'existing';
	}

	const authUser = await findAuthUserByEmail(adminClient, email);
	if (authUser) {
		await provisionProfile(adminClient, {
			authUserId: authUser.id,
			fullName: user.fullName,
			roleNames: user.roleNames,
			actorUserId: null,
			requestId,
			reason: 'Seed repair: auth user without profile'
		});
		console.log(`  ${email}: auth user had no profile; profile and roles provisioned`);
		return 'repaired';
	}

	await createAdminManagedUser(adminClient, {
		email,
		password: user.password,
		fullName: user.fullName,
		roleNames: user.roleNames,
		actorUserId: null,
		requestId
	});
	console.log(`  ${email}: created (${user.roleNames.join(', ')})`);
	return 'created';
}

/**
 * Seeds the initial administrator and, in local development, the fixture users.
 */
export async function seedAdmin(
	customAdminClient?: SupabaseClient,
	env: Env = process.env
): Promise<Record<string, EnsureUserOutcome>> {
	const config = resolveSeedConfig(env);

	if (!customAdminClient && !config.serviceRoleKey) {
		throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to run seed-admin.');
	}

	const adminClient =
		customAdminClient ??
		createClient(config.supabaseUrl, config.serviceRoleKey!, {
			auth: { autoRefreshToken: false, persistSession: false }
		});

	const outcomes: Record<string, EnsureUserOutcome> = {};

	console.log(`Ensuring initial admin (${config.admin.email})...`);
	outcomes[config.admin.email] = await ensureUser(adminClient, config.admin, 'seed-admin');

	if (config.fixtures.length > 0) {
		console.log('APP_ENV=local: ensuring fixture users for the other roles...');
		for (const fixture of config.fixtures) {
			outcomes[fixture.email] = await ensureUser(adminClient, fixture, 'seed-local-test-users');
		}
	}

	return outcomes;
}

function isCliEntry(): boolean {
	const entry = process.argv[1];
	return !!entry && import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isCliEntry()) {
	// Load .env without overriding variables already set in the shell.
	const envPath = resolve(process.cwd(), '.env');
	if (existsSync(envPath)) {
		process.loadEnvFile(envPath);
	}

	seedAdmin()
		.then(() => {
			console.log('Seeding finished successfully.');
			process.exit(0);
		})
		.catch((err) => {
			console.error('Error during admin seeding:', err);
			process.exit(1);
		});
}

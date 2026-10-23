import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createAdminManagedUser } from '../src/lib/server/services/user-admin';

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

/**
 * Checks if a user with the given email already exists in profiles or auth.users.
 */
export async function findExistingUserByEmail(adminClient: SupabaseClient, email: string) {
	const normalizedEmail = email.toLowerCase().trim();

	const { data: profile } = await adminClient
		.from('profiles')
		.select('id, auth_user_id, email, full_name')
		.eq('email', normalizedEmail)
		.maybeSingle();

	if (profile) {
		return profile;
	}

	const { data: usersData } = await adminClient.auth.admin.listUsers();
	const authUser = usersData?.users?.find((u) => u.email?.toLowerCase() === normalizedEmail);

	if (authUser) {
		return { auth_user_id: authUser.id, email: authUser.email };
	}

	return null;
}

/**
 * Seeds the initial administrator and optional local development role test users.
 * Idempotent: checks before creating and skips if already present.
 */
export async function seedAdmin(customAdminClient?: SupabaseClient) {
	const supabaseUrl = process.env.PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
	const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

	if (!customAdminClient && !serviceRoleKey) {
		throw new Error(
			'SUPABASE_SERVICE_ROLE_KEY environment variable is required to run seed-admin.'
		);
	}

	const adminClient =
		customAdminClient ||
		createClient(supabaseUrl, serviceRoleKey!, {
			auth: { autoRefreshToken: false, persistSession: false }
		});

	const adminEmail = (
		process.env.INITIAL_ADMIN_EMAIL ||
		process.env.SEED_ADMIN_EMAIL ||
		'admin@firefighters.local'
	).trim();

	const adminPassword =
		process.env.INITIAL_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD || 'Admin123456!';

	const adminName = (
		process.env.INITIAL_ADMIN_NAME ||
		process.env.SEED_ADMIN_NAME ||
		'System Administrator'
	).trim();

	// 1. Idempotently create primary admin user
	const existingAdmin = await findExistingUserByEmail(adminClient, adminEmail);
	if (existingAdmin) {
		console.log(`Admin user (${adminEmail}) already exists. Skipping admin creation.`);
	} else {
		console.log(`Creating initial admin user: ${adminEmail}`);
		await createAdminManagedUser(adminClient, {
			email: adminEmail,
			password: adminPassword,
			fullName: adminName,
			roleNames: ['admin'],
			actorUserId: null,
			requestId: 'seed-admin'
		});
		console.log(`Created admin user successfully: ${adminEmail}`);
	}

	// 2. If running locally, provision fixture test users for other roles
	const appEnv = process.env.APP_ENV || 'local';
	if (appEnv === 'local') {
		console.log('APP_ENV is local: ensuring test users exist for other roles...');
		const defaultTestPassword = process.env.TEST_USER_PASSWORD || 'LocalDev123456!';

		const testUsers = [
			{
				email: 'operator@firefighters.local',
				password: defaultTestPassword,
				fullName: 'Test Operator',
				roleNames: ['operator']
			},
			{
				email: 'treasurer@firefighters.local',
				password: defaultTestPassword,
				fullName: 'Test Treasurer',
				roleNames: ['treasurer']
			},
			{
				email: 'collector@firefighters.local',
				password: defaultTestPassword,
				fullName: 'Test Collector',
				roleNames: ['collector']
			},
			{
				email: 'readonly@firefighters.local',
				password: defaultTestPassword,
				fullName: 'Test Read Only',
				roleNames: ['read-only']
			}
		];

		for (const user of testUsers) {
			const existing = await findExistingUserByEmail(adminClient, user.email);
			if (existing) {
				console.log(`Test user ${user.email} already exists. Skipping.`);
			} else {
				console.log(`Creating test user: ${user.email} (${user.roleNames.join(', ')})`);
				await createAdminManagedUser(adminClient, {
					email: user.email,
					password: user.password,
					fullName: user.fullName,
					roleNames: user.roleNames,
					actorUserId: null,
					requestId: 'seed-local-test-users'
				});
				console.log(`Created test user successfully: ${user.email}`);
			}
		}
	}
}

// Run directly when called via CLI
if (
	process.argv[1]?.endsWith('seed-admin.ts') ||
	process.argv[1]?.endsWith('seed-admin.js') ||
	import.meta.url === `file://${process.argv[1]}`
) {
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

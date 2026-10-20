import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

/**
 * Privileged Supabase client using the service-role key. Bypasses RLS.
 * Server-only: SvelteKit forbids importing `$lib/server` from client code.
 */
export function createSupabaseAdminClient() {
	const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
	if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
	return createClient(publicEnv.PUBLIC_SUPABASE_URL!, serviceRoleKey, {
		auth: { autoRefreshToken: false, persistSession: false }
	});
}

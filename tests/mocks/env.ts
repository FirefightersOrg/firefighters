export const env = {
	PUBLIC_SUPABASE_URL: process.env.PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321',
	PUBLIC_SUPABASE_ANON_KEY: process.env.PUBLIC_SUPABASE_ANON_KEY || 'test-anon-key',
	SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key',
	APP_ENV: process.env.APP_ENV || 'local',
	...process.env
};

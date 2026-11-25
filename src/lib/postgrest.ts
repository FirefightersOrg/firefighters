/**
 * PostgREST returns at most `max_rows` rows per response (`[api] max_rows` in supabase/config.toml).
 * Every paged read in the app uses this value as its page size, so a long list is read whole instead of
 * being cut silently. `postgrest.test.ts` fails if the config and this constant ever drift apart.
 */
export const POSTGREST_MAX_ROWS = 1000;

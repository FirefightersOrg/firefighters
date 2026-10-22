# Supabase Initialization (`src/lib/supabase/`)

Supabase client/server initialization helpers. Keep free of business rules; domain code must never import from here.

- `browser.ts` — browser client (anon key).
- `server.ts` — cookie-aware server client (anon key).
- The service-role client lives in `src/lib/server/supabase/admin.ts` and must never be imported from here.

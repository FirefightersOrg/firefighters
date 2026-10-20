# Phase 0 verification (SAN-9)

Verified end-to-end on a clean working tree (macOS, Node 24, pnpm 11.17.0, Supabase CLI 2.108.0).

| Check               | Command                          | Result                                                                                                                                                       |
| ------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Install             | `pnpm install --frozen-lockfile` | Pass (lockfile up to date)                                                                                                                                   |
| Type check          | `pnpm check`                     | Pass (0 errors, 0 warnings)                                                                                                                                  |
| Lint + format       | `pnpm lint`                      | Pass (Prettier + ESLint)                                                                                                                                     |
| Build               | `pnpm build`                     | Pass                                                                                                                                                         |
| Dev server          | `pnpm dev`                       | HTTP 200 on `/`; renders the "Firefighters" page; Tailwind CSS emitted (`tailwindcss` banner and `.text-2xl` in `src/app.css`)                               |
| Local Supabase      | `supabase start`                 | Pass; Studio (`:54323`) responds (307 redirect), REST (`:54321/rest/v1/`) and Auth health return 200; stopped with `supabase stop --project-id firefighters` |
| pnpm-only guard     | `npm install`                    | Rejected by `only-allow` (exit code 1)                                                                                                                       |
| `.env.example`      | inspection                       | Contains `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_ENV=local`                                                     |
| `src/lib` structure | inspection                       | All 9 directories present: `components`, `domain`, `schemas`, `supabase`, `server/{auth,repositories,services,audit,documents}`                              |

## Notes

- The `preinstall` guard runs `npx only-allow pnpm`. On a machine that has never fetched `only-allow`, npx asks `Ok to proceed? (y)` and blocks non-interactive installs until answered. The README now mentions it. Consider adding `only-allow` as a devDependency if CI or onboarding hits this.
- `pnpm format:check` is covered by `pnpm lint` and was added to the README script list.

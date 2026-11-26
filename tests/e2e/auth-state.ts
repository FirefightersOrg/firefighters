import { resolveSeedConfig } from '../../scripts/seed-admin';

/**
 * Users and saved-session files of the E2E setup project (SAN-166, see `auth.setup.ts`). Roles are
 * the users `pnpm seed:admin` creates (APP_ENV=local). Add a line to ROLES for another one
 * (operator, treasurer, read-only) when a spec needs it.
 */
const seed = resolveSeedConfig();
const byRole = (role: string) => {
	const user = seed.fixtures.find((u) => u.roleNames.includes(role));
	if (!user) throw new Error(`The ${role} fixture user is missing: run seed:admin first.`);
	return user;
};

export const ROLES = { admin: seed.admin, collector: byRole('collector') };
export type Role = keyof typeof ROLES;

/** `storageState` file of each role, written by the setup project. */
export const STATE = Object.fromEntries(
	Object.keys(ROLES).map((role) => [role, `tests/e2e/.auth/${role}.json`])
) as Record<Role, string>;

/** An empty session: for tests that sign in through the UI themselves. */
export const ANONYMOUS = { cookies: [], origins: [] };

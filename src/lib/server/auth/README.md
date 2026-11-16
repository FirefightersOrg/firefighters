# Auth Helpers (`src/lib/server/auth/`)

Server-side granular permission checking utilities and authentication helpers. Server-only code.

## Architectural Principles

1. **Single Source of Truth in SQL**:
   All authorization rules and permission resolution live in the database functions (`has_permission`, `has_permission_for_user`, `my_permissions`). TypeScript helpers only call these functions via RPC.
2. **Never Check Role Names Directly**:
   Feature authorization must **never** be hardcoded by role name (do not check `role.name === 'admin'` or use `hasRole`). Always check granular permission codes via `hasPermission` or `requirePermission`.
3. **Fail Closed, but Log**:
   Any RPC error, unauthenticated call, or invalid input denies permission (returns `false` or an empty array). RPC failures are logged with `console.error` so an outage does not look like a permissions misconfiguration. `requirePermission` throws **403** for a denial and **500** for an infrastructure failure.
4. **User IDs**:
   - Application-level user IDs in profiles are `profiles.id` (UUID).
   - SQL functions and `hasPermissionForUser` take `auth.users.id` (stored in `profiles.auth_user_id`).
   - `hasPermission`, `getUserPermissions`, and `requirePermission` operate on the authenticated caller (`auth.uid()`).

## Clients and `locals`

Examples below use `supabase` for the **user-scoped** client: anon key plus the user's session cookies, created with `createSupabaseServerClient(event)` from `$lib/supabase/server`. `App.Locals` and `hooks.server.ts` are not defined on this branch; SAN-11/SAN-14 add them (`locals.supabase`, `locals.permissions`). Until then, create the client in the load/action.

All `permissionCode` parameters are typed as `PermissionCode`, so a typo fails `pnpm check`.

## Available Functions

### `hasPermission(supabase, permissionCode): Promise<boolean>`

Checks if the current authenticated caller (via `auth.uid()`) holds the specified permission code.

```typescript
import { hasPermission } from '$lib/server/auth';

const canCreate = await hasPermission(supabase, 'campaign.create');
```

### `checkPermission(supabase, permissionCode): Promise<'granted' | 'denied' | 'error'>`

Same RPC as `hasPermission`, but tells a denial apart from an RPC/infrastructure failure (`'error'`, logged). Use it when you need to handle the two cases differently.

### `requirePermission(supabase, permissionCode): Promise<void>`

Asserts that the current authenticated caller has the specified permission code:

- denied: throws SvelteKit `HttpError` **403** `{ message: 'Forbidden', code: 'permission_denied', permission }`
- RPC failure: throws `HttpError` **500** `{ message: 'Permission check failed', code: 'permission_check_failed', permission }` (error logged, not exposed)

```typescript
import { requirePermission } from '$lib/server/auth';
import { createSupabaseServerClient } from '$lib/supabase/server';

export const actions = {
	default: async (event) => {
		const supabase = createSupabaseServerClient(event);
		await requirePermission(supabase, 'campaign.create');
		// Proceed with action...
	}
};
```

### `getUserPermissions(supabase): Promise<string[]>`

Returns all granular permission codes held by the current authenticated caller in one RPC (`my_permissions()`). Returns an empty array if unauthenticated or on RPC error (logged).

```typescript
import { getUserPermissions } from '$lib/server/auth';

const permissions = await getUserPermissions(supabase);
```

### `hasPermissionIn(permissions, permissionCode): boolean` / `requirePermissionIn(permissions, permissionCode): void`

Request-scoped checks against a precomputed list (the result of `getUserPermissions`), with no database round-trip. Load the list once per request (SAN-11/SAN-14 store it on `locals.permissions`) and reuse it for every check in that request. `requirePermissionIn` throws the same 403 as `requirePermission`.

```typescript
import { getUserPermissions, hasPermissionIn, requirePermissionIn } from '$lib/server/auth';

const permissions = await getUserPermissions(supabase); // one RPC
requirePermissionIn(permissions, 'bond.view');
const canAnnul = hasPermissionIn(permissions, 'bond.annul');
```

Because `getUserPermissions` returns `[]` on RPC failure, an outage shows up here as 403, not 500. Use `requirePermission` where that distinction matters. The list is a snapshot for the current request only; never cache it across requests.

### `hasPermissionForUser(supabase, authUserId, permissionCode): Promise<boolean>`

Checks whether an arbitrary user (`auth.users.id`) holds the specified permission code. This calls the privileged SQL function `public.has_permission_for_user` which requires `service_role` privileges. Calling it with a user-scoped client is an RPC error (logged) and returns `false`.

```typescript
import { hasPermissionForUser } from '$lib/server/auth';
import { createSupabaseAdminClient } from '$lib/server/supabase/admin';

const admin = createSupabaseAdminClient();
const allowed = await hasPermissionForUser(admin, user.id, 'user.manage');
```

## Canonical Permission Codes

Defined in `src/lib/server/auth/permission-codes.ts` (`PERMISSIONS` tuple and `PermissionCode` type).
Represents all 44 granular permissions defined across the system.

The list is hand-maintained. A unit test in `permissions.test.ts` parses the permission inserts in `supabase/migrations/*.sql` and fails `pnpm test` if the two drift. Update both together.

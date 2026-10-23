# Auth Helpers (`src/lib/server/auth/`)

Server-side granular permission checking utilities and authentication helpers. Server-only code.

## Architectural Principles

1. **Single Source of Truth in SQL**:
   All authorization rules and permission resolution live in the database functions (`has_permission`, `has_permission_for_user`, `my_permissions`). TypeScript helpers only call these functions via RPC.
2. **Never Check Role Names Directly**:
   Feature authorization must **never** be hardcoded by role name (do not check `role.name === 'admin'` or use `hasRole`). Always check granular permission codes via `hasPermission` or `requirePermission`.
3. **Fail Closed**:
   Any RPC error, unauthenticated call, or invalid input immediately denies permission (returns `false`, empty array, or throws 403 Forbidden).
4. **User IDs**:
   - Application-level user IDs in profiles are `profiles.id` (UUID).
   - SQL functions and `hasPermissionForUser` take `auth.users.id` (stored in `profiles.auth_user_id`).
   - `hasPermission`, `getUserPermissions`, and `requirePermission` operate on the authenticated caller (`auth.uid()`).

## Available Functions

### `hasPermission(supabase, permissionCode): Promise<boolean>`

Checks if the current authenticated caller (via `auth.uid()`) holds the specified permission code.

```typescript
import { hasPermission } from '$lib/server/auth';

const canCreate = await hasPermission(locals.supabase, 'campaign.create');
```

### `requirePermission(supabase, permissionCode): Promise<void>`

Asserts that the current authenticated caller has the specified permission code. If not, throws a SvelteKit `HttpError` (HTTP 403 Forbidden) with a structured error body (`{ message: 'Forbidden', code: 'permission_denied', permission: permissionCode }`).

```typescript
import { requirePermission } from '$lib/server/auth';

export const actions = {
	default: async ({ locals }) => {
		await requirePermission(locals.supabase, 'campaign.create');
		// Proceed with action...
	}
};
```

### `getUserPermissions(supabase): Promise<string[]>`

Returns all granular permission codes held by the current authenticated caller. Returns an empty array if unauthenticated or on RPC error.

```typescript
import { getUserPermissions } from '$lib/server/auth';

const permissions = await getUserPermissions(locals.supabase);
```

### `hasPermissionForUser(supabase, authUserId, permissionCode): Promise<boolean>`

Checks whether an arbitrary user (`auth.users.id`) holds the specified permission code. This calls the privileged SQL function `public.has_permission_for_user` which requires `service_role` privileges.

```typescript
import { hasPermissionForUser } from '$lib/server/auth';
import { createSupabaseAdminClient } from '$lib/server/supabase/admin';

const admin = createSupabaseAdminClient();
const allowed = await hasPermissionForUser(admin, user.id, 'user.manage');
```

## Canonical Permission Codes

Defined in `src/lib/server/auth/permission-codes.ts` (`PERMISSIONS` tuple and `PermissionCode` type).
Represents all 44 granular permissions defined across the system.

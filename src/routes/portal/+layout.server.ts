import type { LayoutServerLoad } from './$types';
import { requireOwnCollector } from '$lib/server/auth/own-collector';

// Guard for /portal/**: signed-in active user (else /login), `bond.view_own` (else 403), and the
// collector resolved from the session. Child loads call `requireOwnCollector` again with the permission
// they need (loads run in parallel with this one) and form actions must call it on their own.
export const load: LayoutServerLoad = async ({ locals, url }) => {
	const collector = await requireOwnCollector(locals, url.pathname + url.search);
	return { collector };
};

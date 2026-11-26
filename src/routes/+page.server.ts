import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { defaultLandingPath } from '$lib/server/auth/own-collector';
import { listActiveCampaignIds } from '$lib/server/repositories/campaigns';
import { listRoleNamesForProfile } from '$lib/server/repositories/user-roles';

/** Where staff land: the only active campaign, or the list when there is none or several. */
export function _staffLandingPath(activeCampaignIds: readonly string[]): string {
	return activeCampaignIds.length === 1 ? `/campaigns/${activeCampaignIds[0]}` : '/campaigns';
}

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user || !locals.profile) {
		return { user: null, profile: null, roles: [], rolesError: false };
	}

	// Collectors land on their portal (the operational screens answer 403 to them).
	const landing = defaultLandingPath(locals.permissions);
	if (landing !== '/') redirect(303, landing);

	// Staff go straight to the work (UX plan PR 6, audit A11): the active campaign when there is
	// exactly one, otherwise the list. This page stays for whoever cannot open campaigns.
	if ((locals.permissions ?? []).includes('campaign.view')) {
		const active = await listActiveCampaignIds(locals.supabase);
		if (active.error) {
			console.error('[home] active campaigns lookup failed', {
				requestId: locals.requestId,
				error: active.error
			});
		}
		redirect(303, _staffLandingPath(active.data ?? []));
	}

	const { data: roles, error } = await listRoleNamesForProfile(locals.supabase, locals.profile.id);
	if (error) {
		console.error('[home] role lookup failed', { requestId: locals.requestId, error });
	}

	return {
		user: locals.user,
		profile: locals.profile,
		roles: roles ?? [],
		rolesError: !!error
	};
};

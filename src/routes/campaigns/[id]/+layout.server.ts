import type { LayoutServerLoad } from './$types';
import { hasPermissionIn } from '$lib/server/auth/permissions';
import { isUuid } from '$lib/server/deliveries/route-helpers';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { countOpenSettlements } from '$lib/server/repositories/settlements';

/**
 * What the campaign shell needs around every page of a campaign: its name, and how many
 * settlements are open (shown beside «Rendiciones» to whoever may see settlements).
 *
 * It never fails the request. A malformed id, a campaign that does not exist or cannot be read, or
 * a failed query leave `shell` null: the page's own load answers 404 or 500 as before, and the
 * layout falls back to the plain header.
 */
export const load: LayoutServerLoad = async ({ locals, params }) => {
	if (!isUuid(params.id)) return { shell: null };
	const permissions = locals.permissions ?? [];
	const seesSettlements = (
		[
			'settlement.view',
			'settlement.create',
			'settlement.update_open',
			'settlement.close',
			'settlement.correct'
		] as const
	).some((permission) => hasPermissionIn(permissions, permission));

	const [campaign, open] = await Promise.all([
		getCampaignById(locals.supabase, params.id),
		seesSettlements ? countOpenSettlements(locals.supabase, params.id) : null
	]);
	if (campaign.error || !campaign.data) return { shell: null };
	if (open?.error) {
		console.error('[campaign shell] open settlements count failed', {
			requestId: locals.requestId,
			error: open.error
		});
	}
	return {
		shell: {
			campaign: { id: campaign.data.id, name: campaign.data.name },
			openSettlements: open && !open.error ? open.data : null
		}
	};
};

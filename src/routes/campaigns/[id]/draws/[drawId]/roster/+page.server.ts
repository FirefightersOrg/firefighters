import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import {
	hasPermissionIn,
	permissionsUnavailable,
	requirePermissionIn
} from '$lib/server/auth/permissions';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import {
	getCurrentDrawRoster,
	getDraw,
	listDrawRosterEntries
} from '$lib/server/repositories/draws';
import { campaignNumberingConfig } from '$lib/domain/campaigns';
import { formatCampaignNumber } from '$lib/domain/numbering';
import { DRAW_INELIGIBILITY_REASON_LABELS } from '$lib/domain/draw-eligibility';
import { uuid } from '$lib/server/draws/route-helpers';

const PAGE_SIZE = 50;
export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (permissionsUnavailable(locals.permissions))
		error(500, { message: 'Could not load permissions.' });
	requireCampaignViewer(locals, url);
	if (
		![
			'draw.view',
			'draw.create',
			'draw.update',
			'draw.generate_roster',
			'draw.freeze_roster',
			'draw.load_winner'
		].some((permission) => hasPermissionIn(locals.permissions, permission as never))
	)
		requirePermissionIn(locals.permissions, 'draw.view');
	if (!uuid.safeParse(params.drawId).success) error(404, { message: 'Draw not found.' });
	const [campaign, draw] = await Promise.all([
		getCampaignById(locals.supabase, params.id),
		getDraw(locals.supabase, params.id, params.drawId)
	]);
	if (campaign.error || draw.error) error(500, { message: 'Could not load roster.' });
	if (!campaign.data) error(404, { message: 'Campaign not found.' });
	if (!draw.data) error(404, { message: 'Draw not found.' });
	const roster = await getCurrentDrawRoster(locals.supabase, draw.data.id);
	if (roster.error) error(500, { message: 'Could not load roster.' });
	if (!roster.data) error(404, { message: 'Roster not found.' });
	const result = await listDrawRosterEntries(locals.supabase, roster.data.id);
	if (result.error) error(500, { message: 'Could not load roster.' });
	const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
	const eligibility = url.searchParams.get('eligibility') ?? '';
	const config = campaignNumberingConfig(campaign.data);
	const filtered = (result.data ?? [])
		.map((entry) => ({
			...entry,
			formattedNumber: formatCampaignNumber(entry.numberValue, config),
			reasonLabel: entry.ineligibilityReason
				? (DRAW_INELIGIBILITY_REASON_LABELS[
						entry.ineligibilityReason as keyof typeof DRAW_INELIGIBILITY_REASON_LABELS
					] ?? entry.ineligibilityReason)
				: null
		}))
		.filter(
			(entry) =>
				(!query ||
					entry.formattedNumber.includes(query) ||
					entry.bondLabel.toLowerCase().includes(query) ||
					entry.buyerName.toLowerCase().includes(query) ||
					entry.collectorName.toLowerCase().includes(query)) &&
				(!eligibility || (eligibility === 'eligible' ? entry.eligible : !entry.eligible))
		);
	const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
	const requested = Number(url.searchParams.get('page') ?? '1');
	const page = Number.isInteger(requested) ? Math.min(Math.max(1, requested), pages) : 1;
	return {
		campaign: campaign.data,
		draw: draw.data,
		roster: roster.data,
		entries: filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
		filters: { q: url.searchParams.get('q') ?? '', eligibility },
		pagination: { page, pages, total: filtered.length }
	};
};

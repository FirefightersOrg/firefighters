import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { PageServerLoad } from './$types';
import { hasPermissionIn, permissionsUnavailable } from '$lib/server/auth/permissions';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import { buildPrintableUnawardedPrizeCertificate } from '$lib/server/documents/unawarded-prize-certificate';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { getPrizeCertificateData } from '$lib/server/repositories/printable-prizes';

const READ_PERMISSIONS = [
	'draw.view',
	'draw.create',
	'draw.update',
	'draw.generate_roster',
	'draw.freeze_roster',
	'draw.load_winner',
	'prize.resolve',
	'prize.deliver',
	'prize.annul'
] as const;
const uuid = (value: string) => z.guid().safeParse(value).success;

export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (permissionsUnavailable(locals.permissions))
		error(500, { message: 'Could not load permissions.' });
	requireCampaignViewer(locals, url);
	if (!READ_PERMISSIONS.some((permission) => hasPermissionIn(locals.permissions, permission)))
		error(403, { message: 'You do not have permission to view this certificate.' });
	if (!uuid(params.id) || !uuid(params.drawId) || !uuid(params.prizeId))
		error(404, { message: 'Prize not found.' });
	const [campaign, found] = await Promise.all([
		getCampaignById(locals.supabase, params.id),
		getPrizeCertificateData(locals.supabase, params.prizeId)
	]);
	if (campaign.error || found.error) {
		if ((found.error as { code?: string } | null)?.code === 'P0002')
			error(404, { message: 'Prize not found.' });
		error(500, { message: 'Could not load the prize certificate.' });
	}
	if (!campaign.data) error(404, { message: 'Campaign not found.' });
	if (!found.data || found.data.campaignId !== params.id || found.data.drawId !== params.drawId)
		error(404, { message: 'Prize not found.' });
	if (found.data.prizeStatus !== 'unawarded')
		error(404, { message: 'Certificate is only available for unawarded prizes.' });
	return { document: buildPrintableUnawardedPrizeCertificate(campaign.data, found.data) };
};

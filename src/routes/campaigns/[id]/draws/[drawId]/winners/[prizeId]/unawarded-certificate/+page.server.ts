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
		error(500, { message: 'No se pudieron cargar los permisos.' });
	requireCampaignViewer(locals, url);
	if (!READ_PERMISSIONS.some((permission) => hasPermissionIn(locals.permissions, permission)))
		error(403, { message: 'No hay permiso para ver este certificado.' });
	if (!uuid(params.id) || !uuid(params.drawId) || !uuid(params.prizeId))
		error(404, { message: 'Premio no encontrado.' });
	const [campaign, found] = await Promise.all([
		getCampaignById(locals.supabase, params.id),
		getPrizeCertificateData(locals.supabase, params.prizeId)
	]);
	if (campaign.error || found.error) {
		if ((found.error as { code?: string } | null)?.code === 'P0002')
			error(404, { message: 'Premio no encontrado.' });
		error(500, { message: 'No se pudo cargar el certificado del premio.' });
	}
	if (!campaign.data) error(404, { message: 'Campaña no encontrada.' });
	if (!found.data || found.data.campaignId !== params.id || found.data.drawId !== params.drawId)
		error(404, { message: 'Premio no encontrado.' });
	if (found.data.prizeStatus !== 'unawarded')
		error(404, { message: 'El certificado solo está disponible para premios no adjudicados.' });
	return { document: buildPrintableUnawardedPrizeCertificate(campaign.data, found.data) };
};

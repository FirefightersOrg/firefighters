import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { PermissionCode } from '$lib/server/auth/permission-codes';
import {
	hasPermissionIn,
	permissionsUnavailable,
	requirePermissionIn
} from '$lib/server/auth/permissions';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { listDraws } from '$lib/server/repositories/draws';
import { DRAW_STATUSES, DRAW_TYPES, type DrawStatus, type DrawType } from '$lib/domain/draws';

const DRAW_PERMISSIONS: PermissionCode[] = [
	'draw.view',
	'draw.create',
	'draw.update',
	'draw.generate_roster',
	'draw.freeze_roster',
	'draw.load_winner'
];
export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (permissionsUnavailable(locals.permissions))
		error(500, { message: 'No se pudieron cargar los permisos.' });
	requireCampaignViewer(locals, url);
	if (!DRAW_PERMISSIONS.some((permission) => hasPermissionIn(locals.permissions, permission)))
		requirePermissionIn(locals.permissions, 'draw.view');
	const type = url.searchParams.get('type') ?? '';
	const status = url.searchParams.get('status') ?? '';
	const [campaign, draws] = await Promise.all([
		getCampaignById(locals.supabase, params.id),
		listDraws(locals.supabase, params.id, {
			type: DRAW_TYPES.includes(type as DrawType) ? (type as DrawType) : null,
			status: DRAW_STATUSES.includes(status as DrawStatus) ? (status as DrawStatus) : null
		})
	]);
	if (campaign.error || draws.error) error(500, { message: 'No se pudieron cargar los sorteos.' });
	if (!campaign.data) error(404, { message: 'Campaña no encontrada.' });
	return {
		campaign: campaign.data,
		draws: draws.data ?? [],
		filters: { type, status },
		can: { create: hasPermissionIn(locals.permissions, 'draw.create') }
	};
};

import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { PageServerLoad } from './$types';
import { permissionsUnavailable, requirePermissionIn } from '$lib/server/auth/permissions';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import {
	getCampaignAuditEntry,
	listCampaignAuditEntries
} from '$lib/server/repositories/audit-log';
import { getCampaignById } from '$lib/server/repositories/campaigns';

const optionalDay = (value: string | null) =>
	value && z.iso.date().safeParse(value).success ? value : null;
const optionalUuid = (value: string | null) =>
	value && z.guid().safeParse(value).success ? value : null;

export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (permissionsUnavailable(locals.permissions))
		error(500, { message: 'Could not load permissions.' });
	requireCampaignViewer(locals, url);
	requirePermissionIn(locals.permissions, 'audit.view');
	if (!z.guid().safeParse(params.id).success) error(404, { message: 'Campaign not found.' });

	const campaign = await getCampaignById(locals.supabase, params.id);
	if (campaign.error) error(500, { message: 'Could not load audit log.' });
	if (!campaign.data) error(404, { message: 'Campaign not found.' });

	const filters = {
		actor: optionalUuid(url.searchParams.get('actor')),
		action: url.searchParams.get('action')?.trim().slice(0, 120) || null,
		entityType: url.searchParams.get('entityType')?.trim().slice(0, 120) || null,
		from: optionalDay(url.searchParams.get('from')),
		to: optionalDay(url.searchParams.get('to')),
		page: Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
	};
	const detailId = optionalUuid(url.searchParams.get('detail'));
	const [entries, detail] = await Promise.all([
		listCampaignAuditEntries(locals.supabase, params.id, filters),
		detailId
			? getCampaignAuditEntry(locals.supabase, params.id, detailId)
			: Promise.resolve({ data: null, error: null })
	]);
	if (entries.error || detail.error) error(500, { message: 'Could not load audit log.' });
	if (detailId && !detail.data) error(404, { message: 'Audit entry not found.' });
	return { campaign: campaign.data, entries: entries.data!, detail: detail.data, filters };
};

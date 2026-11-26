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
import { describeAuditEntries } from '$lib/server/audit-presentation';
import { reportPage } from '$lib/report-views';
import { AUDIT_PAGE_SIZE } from '$lib/server/repositories/audit-log';

const optionalDay = (value: string | null) =>
	value && z.iso.date().safeParse(value).success ? value : null;
const optionalUuid = (value: string | null) =>
	value && z.guid().safeParse(value).success ? value : null;

export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (permissionsUnavailable(locals.permissions))
		error(500, { message: 'No se pudieron cargar los permisos.' });
	requireCampaignViewer(locals, url);
	requirePermissionIn(locals.permissions, 'audit.view');
	if (!z.guid().safeParse(params.id).success) error(404, { message: 'Campaña no encontrada.' });

	const campaign = await getCampaignById(locals.supabase, params.id);
	if (campaign.error) error(500, { message: 'No se pudo cargar la auditoría.' });
	if (!campaign.data) error(404, { message: 'Campaña no encontrada.' });

	const filters = {
		actor: optionalUuid(url.searchParams.get('actor')),
		action: url.searchParams.get('action')?.trim().slice(0, 120) || null,
		entityType: url.searchParams.get('entityType')?.trim().slice(0, 120) || null,
		from: optionalDay(url.searchParams.get('from')),
		to: optionalDay(url.searchParams.get('to')),
		page: reportPage(url.searchParams.get('page'))
	};
	const pageSize = 25;
	const repositoryPage = Math.floor(((filters.page - 1) * pageSize) / AUDIT_PAGE_SIZE) + 1;
	const pageOffset = ((filters.page - 1) * pageSize) % AUDIT_PAGE_SIZE;
	const detailId = optionalUuid(url.searchParams.get('detail'));
	const person = [...(url.searchParams.get('person')?.trim() ?? '')].slice(0, 120).join('');
	// Both reads use frozen campaign membership, including sparse creation/state-change
	// snapshots; a detail id must never bypass that campaign boundary (SAN-112).
	const [entries, detail] = await Promise.all([
		listCampaignAuditEntries(locals.supabase, params.id, { ...filters, page: repositoryPage }),
		detailId
			? getCampaignAuditEntry(locals.supabase, params.id, detailId)
			: Promise.resolve({ data: null, error: null })
	]);
	if (entries.error || detail.error) error(500, { message: 'No se pudo cargar la auditoría.' });
	if (detailId && !detail.data) error(404, { message: 'Registro de auditoría no encontrado.' });
	try {
		let presented = await describeAuditEntries(
			locals.supabase,
			entries.data!.items,
			locals.permissions!,
			campaign.data.numberDigits
		);
		const initial = presented;
		let result = {
			...entries.data!,
			page: filters.page,
			pageSize,
			items: presented.slice(pageOffset, pageOffset + pageSize)
		};
		if (person) {
			// Search the complete, already authorized history, not only the currently visible page.
			// Keep the repository's deterministic range paging, including histories over 1,000 rows.
			const normalize = (text: string) =>
				text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
			const needle = normalize(person);
			const matches: typeof presented = [];
			for (let page = 1; ; page++) {
				const batch =
					page === repositoryPage
						? entries
						: await listCampaignAuditEntries(locals.supabase, params.id, { ...filters, page });
				if (batch.error) throw batch.error;
				presented =
					page === repositoryPage
						? initial
						: await describeAuditEntries(
								locals.supabase,
								batch.data!.items,
								locals.permissions!,
								campaign.data.numberDigits
							);
				matches.push(
					...presented.filter((entry) =>
						normalize(`${entry.actorName ?? ''} ${entry.subject}`).includes(needle)
					)
				);
				if (page * AUDIT_PAGE_SIZE >= batch.data!.total) break;
			}
			result = {
				...result,
				items: matches.slice((filters.page - 1) * pageSize, filters.page * pageSize),
				total: matches.length
			};
		}
		return {
			campaign: campaign.data,
			entries: result,
			detail: detail.data,
			filters: { ...filters, person }
		};
	} catch (cause) {
		console.error('[audit] context load failed', { requestId: locals.requestId, cause });
		error(500, { message: 'No se pudo cargar la auditoría.' });
	}
};

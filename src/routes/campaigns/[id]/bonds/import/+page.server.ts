import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { canLoadBonds } from '$lib/domain/campaigns';
import { IMPORT_MAX_FILE_BYTES } from '$lib/domain/imports';
import { requirePermissionIn } from '$lib/server/auth/permissions';
import { campaignLockedMessage } from '$lib/server/bonds/route-helpers';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import {
	checkImportActionPermission,
	importFormFailure,
	importServiceFailure,
	isUuid,
	loadImportCampaign,
	textField
} from '$lib/server/imports/route-helpers';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { listImportSessions } from '$lib/server/repositories/imports';
import { IMPORT_FILE_NAME_MAX_LENGTH, IMPORT_NOTES_MAX_LENGTH } from '$lib/schemas/import';
import { IMPORT_MESSAGES, stageImportFile } from '$lib/server/services/imports';

/**
 * /campaigns/[id]/bonds/import: upload a CSV or Excel file of bonds
 * (`tipo_bono,grupo_pata,numero_base,barcode`) and list the campaign's file imports. Requires an
 * active user with `campaign.view` and `bond.import` (else 403). Uploading runs
 * `stageImportFile` (parse → interpret per the campaign's barcode rules → create the session →
 * stage → validate) and opens the preview, which confirms the batch. Nothing is created until then.
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireCampaignViewer(locals, url);
	requirePermissionIn(locals.permissions, 'bond.import');
	const campaign = await loadImportCampaign(locals, params.id);

	const sessions = await listImportSessions(locals.supabase, campaign.id, [
		'csv_file',
		'excel_file'
	]);
	if (sessions.error) {
		console.error('[imports] session list failed', {
			requestId: locals.requestId,
			campaignId: campaign.id,
			error: sessions.error
		});
		error(500, { message: 'No se pudieron cargar las importaciones. Volver a intentar.' });
	}

	return {
		campaign,
		sessions: sessions.data,
		canLoad: canLoadBonds(campaign.status),
		lockedMessage: canLoadBonds(campaign.status) ? null : campaignLockedMessage(campaign.status)
	};
};

export const actions: Actions = {
	upload: async ({ request, locals, params, url }) => {
		const denied = checkImportActionPermission(locals, url, 'upload', 'bond.import');
		if (denied) return denied;
		if (!isUuid(params.id))
			return importFormFailure('upload', 404, IMPORT_MESSAGES.campaignNotFound);

		const formData = await request.formData();
		const file = formData.get('file');
		const notes = textField(formData, 'notes');
		const values = { notes: notes ?? '' };
		const fileFailure = (message: string) =>
			importFormFailure('upload', 400, message, { errors: { file: [message] }, values });

		if (!(file instanceof File) || file.size === 0 || file.name.trim() === '') {
			return fileFailure('Elegir un archivo CSV o de Excel para subir.');
		}
		const fileName = file.name.trim();
		if (!/\.(csv|xlsx)$/i.test(fileName)) {
			return fileFailure('Solo se pueden importar archivos .csv y .xlsx.');
		}
		if (file.size > IMPORT_MAX_FILE_BYTES) return fileFailure('El archivo supera los 5 MB.');
		if (fileName.length > IMPORT_FILE_NAME_MAX_LENGTH) {
			return fileFailure(
				`El nombre del archivo supera los ${IMPORT_FILE_NAME_MAX_LENGTH} caracteres.`
			);
		}
		if (notes && notes.length > IMPORT_NOTES_MAX_LENGTH) {
			const message = `Las notas admiten hasta ${IMPORT_NOTES_MAX_LENGTH} caracteres.`;
			return importFormFailure('upload', 400, message, { errors: { notes: [message] }, values });
		}

		const campaignResult = await getCampaignById(locals.supabase, params.id);
		if (campaignResult.error) {
			console.error('[imports] campaign lookup failed', {
				requestId: locals.requestId,
				campaignId: params.id,
				error: campaignResult.error
			});
			return importFormFailure('upload', 500, IMPORT_MESSAGES.internal, { values });
		}
		const campaign = campaignResult.data;
		if (!campaign) return importFormFailure('upload', 404, IMPORT_MESSAGES.campaignNotFound);
		if (!canLoadBonds(campaign.status)) {
			return importFormFailure('upload', 409, campaignLockedMessage(campaign.status), { values });
		}

		let sessionId: string;
		try {
			const staged = await stageImportFile(
				locals.supabase,
				{
					campaignId: campaign.id,
					fileName,
					bytes: new Uint8Array(await file.arrayBuffer()),
					notes
				},
				{ requestId: locals.requestId, permissions: locals.permissions }
			);
			sessionId = staged.sessionId;
		} catch (err) {
			// A file that cannot be read is reported on the file field.
			const fileError = (err as { fileErrorCode?: string } | null)?.fileErrorCode;
			const message = err instanceof Error ? err.message : '';
			return importServiceFailure(
				'upload',
				err,
				fileError ? { errors: { file: [message] }, values } : { values }
			);
		}

		redirect(303, `/campaigns/${campaign.id}/bonds/import/${sessionId}`);
	}
};

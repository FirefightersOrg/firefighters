import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { canLoadBonds } from '$lib/domain/campaigns';
import { barcodeNeedsManualNumber } from '$lib/domain/barcodes';
import { translateImportMessage } from '$lib/domain/import-messages';
import { isImportSessionOpen } from '$lib/domain/import-preview';
import { requirePermissionIn } from '$lib/server/auth/permissions';
import { campaignLockedMessage } from '$lib/server/bonds/route-helpers';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import {
	checkImportActionPermission,
	importFormFailure,
	importServiceFailure,
	isUuid,
	loadImportCampaign,
	textField,
	type ImportFormResult
} from '$lib/server/imports/route-helpers';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import {
	getImportSession,
	getImportItem,
	listImportItems,
	listImportSessions
} from '$lib/server/repositories/imports';
import { importAddScanSchema } from '$lib/schemas/import';
import {
	IMPORT_MESSAGES,
	addScanItem,
	createImportSession,
	getImportSessionSummary,
	type ImportSessionSummary
} from '$lib/server/services/imports';

/** Scans shown under the scanner (newest first). */
const RECENT_SCANS = 15;

/**
 * /campaigns/[id]/bonds/scan: barcode entry with a USB/Bluetooth scanner (keyboard wedge). Each
 * scan is staged in an open `barcode_scan` import session (`?session=<id>`) and validated at
 * once; the preview page confirms the batch. Requires `campaign.view` and `bond.scan`.
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireCampaignViewer(locals, url);
	requirePermissionIn(locals.permissions, 'bond.scan');
	const campaign = await loadImportCampaign(locals, params.id);

	const sessionsResult = await listImportSessions(locals.supabase, campaign.id, ['barcode_scan']);
	if (sessionsResult.error) failLoad(locals, campaign.id, sessionsResult.error);
	const openSessions = sessionsResult.data.filter((s) => isImportSessionOpen(s.status));

	const base = {
		campaign,
		needsBaseNumber: barcodeNeedsManualNumber(campaign),
		canLoad: canLoadBonds(campaign.status),
		lockedMessage: canLoadBonds(campaign.status) ? null : campaignLockedMessage(campaign.status),
		openSessions
	};

	const sessionId = url.searchParams.get('session');
	if (!sessionId) return { ...base, session: null, summary: null, recent: [] };
	if (!isUuid(sessionId)) error(404, { message: IMPORT_MESSAGES.sessionNotFound });

	const sessionResult = await getImportSession(locals.supabase, sessionId);
	if (sessionResult.error) failLoad(locals, campaign.id, sessionResult.error);
	const session = sessionResult.data;
	if (!session || session.campaignId !== campaign.id || session.sourceType !== 'barcode_scan') {
		error(404, { message: IMPORT_MESSAGES.sessionNotFound });
	}
	// A confirmed or cancelled session is reviewed on its preview page.
	if (!isImportSessionOpen(session.status)) {
		redirect(303, `/campaigns/${campaign.id}/bonds/import/${session.id}`);
	}

	let summary: ImportSessionSummary;
	try {
		summary = await getImportSessionSummary(locals.supabase, session.id, {
			requestId: locals.requestId
		});
	} catch (err) {
		failLoad(locals, campaign.id, err);
	}
	const recent = await listImportItems(locals.supabase, session.id);
	if (recent.error) failLoad(locals, campaign.id, recent.error);

	return {
		...base,
		session,
		summary,
		recent: recent.data
			.filter((i) => i.removedAt === null)
			.slice(-RECENT_SCANS)
			.reverse()
	};
};

function failLoad(locals: App.Locals, campaignId: string, err: unknown): never {
	console.error('[imports] scan page load failed', {
		requestId: locals.requestId,
		campaignId,
		error: err
	});
	error(500, { message: 'No se pudo cargar el escáner. Volver a intentar.' });
}

export const actions: Actions = {
	/** Open a new scan session and go to it. */
	start: async ({ request, locals, params, url }) => {
		const denied = checkImportActionPermission(locals, url, 'start', 'bond.scan');
		if (denied) return denied;
		if (!isUuid(params.id)) return importFormFailure('start', 404, IMPORT_MESSAGES.campaignNotFound);
		const formData = await request.formData();
		const notes = textField(formData, 'notes');
		if (notes && notes.length > 2000) {
			return importFormFailure('start', 400, 'Las notas admiten hasta 2000 caracteres.');
		}
		let sessionId: string;
		try {
			sessionId = await createImportSession(
				locals.supabase,
				{ campaignId: params.id, sourceType: 'barcode_scan', fileName: null, notes },
				{ requestId: locals.requestId, permissions: locals.permissions }
			);
		} catch (err) {
			return importServiceFailure('start', err);
		}
		redirect(303, `/campaigns/${params.id}/bonds/scan?session=${sessionId}`);
	},

	/** Stage one scanned code; returns the staged row and the new counts for instant feedback. */
	scan: async ({ request, locals, params, url }) => {
		const denied = checkImportActionPermission(locals, url, 'scan', 'bond.scan');
		if (denied) return denied;
		const formData = await request.formData();
		const sessionId = textField(formData, 'sessionId') ?? '';
		const rawBase = textField(formData, 'baseNumber');
		const values = { groupKey: textField(formData, 'groupKey') ?? '', baseNumber: rawBase ?? '' };
		if (!isUuid(params.id) || !isUuid(sessionId)) {
			return importFormFailure('scan', 404, IMPORT_MESSAGES.sessionNotFound, { values });
		}
		const parsed = importAddScanSchema.safeParse({
			sessionId,
			barcode: textField(formData, 'barcode'),
			groupKey: values.groupKey,
			baseNumber: rawBase,
			rawValue: null
		});
		if (!parsed.success) {
			const errors: Record<string, string[]> = {};
			for (const issue of parsed.error.issues) {
				(errors[String(issue.path[0])] ??= []).push(`${issue.message}.`);
			}
			const first = Object.values(errors)[0]?.[0] ?? 'Escanear o ingresar un código de barras.';
			return importFormFailure('scan', 400, first, { errors, values });
		}
		const barcode = parsed.data.barcode as string;

		// The session must belong to this campaign (RLS hides other campaigns' rows only by
		// permission, not by campaign).
		const [campaignResult, sessionResult] = await Promise.all([
			getCampaignById(locals.supabase, params.id),
			getImportSession(locals.supabase, sessionId)
		]);
		if (campaignResult.error || sessionResult.error) {
			console.error('[imports] scan lookup failed', {
				requestId: locals.requestId,
				sessionId,
				error: campaignResult.error ?? sessionResult.error
			});
			return importFormFailure('scan', 500, IMPORT_MESSAGES.internal, { values });
		}
		if (!campaignResult.data) return importFormFailure('scan', 404, IMPORT_MESSAGES.campaignNotFound);
		if (!canLoadBonds(campaignResult.data.status)) {
			return importFormFailure('scan', 409, campaignLockedMessage(campaignResult.data.status), {
				values
			});
		}
		if (
			!sessionResult.data ||
			sessionResult.data.campaignId !== params.id ||
			sessionResult.data.sourceType !== 'barcode_scan'
		) {
			return importFormFailure('scan', 404, IMPORT_MESSAGES.sessionNotFound, { values });
		}

		let summary;
		try {
			summary = await addScanItem(locals.supabase, parsed.data, {
				requestId: locals.requestId,
				permissions: locals.permissions
			});
		} catch (err) {
			return importServiceFailure('scan', err, { values });
		}

		// The row this request staged (returned by the database), never "the session's last row":
		// a fast scanner sends the next code before this answer arrives.
		let scanned = null;
		if (summary.itemId) {
			const staged = await getImportItem(locals.supabase, summary.itemId);
			if (staged.error) {
				console.error('[imports] scanned row lookup failed', {
					requestId: locals.requestId,
					sessionId,
					error: staged.error
				});
			}
			scanned = staged.data ?? null;
		}
		const result: ImportFormResult = {
			form: 'scan',
			success: scanned?.status !== 'error',
			message: (scanned?.errorMessage ? translateImportMessage(scanned.errorMessage) : null) ??
				`Código ${barcode} cargado.`,
			summary,
			scanned,
			values
		};
		return result;
	}
};

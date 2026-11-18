import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad, RequestEvent } from './$types';
import { canLoadBonds } from '$lib/domain/campaigns';
import {
	importSessionPermission,
	isImportSessionOpen,
	parseImportItemFilter
} from '$lib/domain/import-preview';
import { hasPermissionIn, requirePermissionIn } from '$lib/server/auth/permissions';
import { campaignLockedMessage } from '$lib/server/bonds/route-helpers';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import {
	checkImportActionPermission,
	importFormFailure,
	importServiceFailure,
	isUuid,
	loadImportCampaign,
	textField,
	type ImportFormName,
	type ImportFormResult
} from '$lib/server/imports/route-helpers';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import {
	getImportItem,
	getImportSession,
	listImportItems,
	type ImportSession
} from '$lib/server/repositories/imports';
import {
	IMPORT_REASON_MAX_LENGTH,
	importRollbackSchema,
	importUpdateItemSchema
} from '$lib/schemas/import';
import {
	IMPORT_MESSAGES,
	IMPORT_CONFIRM_MESSAGES,
	ImportServiceError,
	cancelImportSession,
	confirmImportSession,
	getImportSessionSummary,
	removeImportItem,
	rollBackImportSession,
	updateImportItem,
	validateImportSession,
	type ImportSessionSummary
} from '$lib/server/services/imports';

/** Rows shown per page of the preview table. */
const PAGE_SIZE = 200;
const FIX_FIELDS = 'Please correct the highlighted fields.';

/**
 * /campaigns/[id]/bonds/import/[sessionId]: the preview of an import (file or scan). Shows the
 * seven summary metrics, the staged rows filtered by status (`?status=valid|warning|error`) and,
 * while the session is open, lets the operator correct or remove rows, validate and confirm.
 * Requires `campaign.view` and the session's permission (`bond.import` for files, `bond.scan`
 * for scans). Rolling back a confirmed import needs `bond.annul`.
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireCampaignViewer(locals, url);
	if (!hasPermissionIn(locals.permissions, 'bond.scan')) {
		requirePermissionIn(locals.permissions, 'bond.import');
	}
	const campaign = await loadImportCampaign(locals, params.id);
	if (!isUuid(params.sessionId)) error(404, { message: IMPORT_MESSAGES.sessionNotFound });

	const sessionResult = await getImportSession(locals.supabase, params.sessionId);
	if (sessionResult.error) failLoad(locals, params.sessionId, sessionResult.error);
	const session = sessionResult.data;
	if (!session || session.campaignId !== campaign.id) {
		error(404, { message: IMPORT_MESSAGES.sessionNotFound });
	}
	requirePermissionIn(locals.permissions, importSessionPermission(session.sourceType));

	const filter = parseImportItemFilter(url.searchParams.get('status'));
	const requested = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
	let summary: ImportSessionSummary;
	try {
		summary = await getImportSessionSummary(locals.supabase, session.id, {
			requestId: locals.requestId
		});
	} catch (err) {
		failLoad(locals, session.id, err);
	}
	// Removed rows are listed only with the `all` filter (as history).
	const items = await listImportItems(locals.supabase, session.id, {
		includeRemoved: filter === 'all'
	});
	if (items.error) failLoad(locals, session.id, items.error);

	const matching =
		filter === 'all' ? items.data : items.data.filter((item) => item.status === filter);
	const pageCount = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
	const page = Math.min(requested, pageCount);
	const open = isImportSessionOpen(session.status);
	return {
		campaign,
		session,
		summary,
		items: matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
		total: matching.length,
		filter,
		page,
		pageSize: PAGE_SIZE,
		justConfirmed: url.searchParams.get('confirmed') === '1',
		canEdit: open && canLoadBonds(campaign.status),
		lockedMessage:
			open && !canLoadBonds(campaign.status) ? campaignLockedMessage(campaign.status) : null,
		canRollBack:
			session.status === 'confirmed' &&
			session.rolledBackAt === null &&
			hasPermissionIn(locals.permissions, 'bond.annul')
	};
};

function failLoad(locals: App.Locals, sessionId: string, err: unknown): never {
	console.error('[imports] session preview load failed', {
		requestId: locals.requestId,
		sessionId,
		error: err
	});
	error(500, { message: 'Could not load the import. Please try again.' });
}

/**
 * Common start of the session actions: active user, the session of this campaign (it must be
 * readable), and the permission for its source. Returns the session or a `fail()` result.
 */
async function sessionForAction(
	event: RequestEvent,
	form: ImportFormName,
	options: { openCampaign?: boolean } = {}
): Promise<{ session: ImportSession } | { failure: ReturnType<typeof importFormFailure> }> {
	const { locals, params, url } = event;
	// Either import permission lets the session be read; its own permission is checked below.
	const canRead = hasPermissionIn(locals.permissions, 'bond.scan') ? 'bond.scan' : 'bond.import';
	const denied = checkImportActionPermission(locals, url, form, canRead);
	if (denied) return { failure: denied };
	if (!isUuid(params.id) || !isUuid(params.sessionId)) {
		return { failure: importFormFailure(form, 404, IMPORT_MESSAGES.sessionNotFound) };
	}
	const result = await getImportSession(locals.supabase, params.sessionId);
	if (result.error) {
		console.error('[imports] session lookup failed', {
			requestId: locals.requestId,
			sessionId: params.sessionId,
			error: result.error
		});
		return { failure: importFormFailure(form, 500, IMPORT_MESSAGES.internal) };
	}
	if (!result.data || result.data.campaignId !== params.id) {
		return { failure: importFormFailure(form, 404, IMPORT_MESSAGES.sessionNotFound) };
	}
	if (!hasPermissionIn(locals.permissions, importSessionPermission(result.data.sourceType))) {
		return { failure: importFormFailure(form, 403, IMPORT_MESSAGES.permission) };
	}
	if (options.openCampaign) {
		// Same guard as the upload: rows of a campaign that no longer accepts bonds are not edited.
		const campaign = await getCampaignById(locals.supabase, params.id);
		if (campaign.error) {
			console.error('[imports] campaign lookup failed', {
				requestId: locals.requestId,
				campaignId: params.id,
				error: campaign.error
			});
			return { failure: importFormFailure(form, 500, IMPORT_MESSAGES.internal) };
		}
		if (campaign.data && !canLoadBonds(campaign.data.status)) {
			return {
				failure: importFormFailure(form, 409, campaignLockedMessage(campaign.data.status))
			};
		}
	}
	return { session: result.data };
}

/** The row must belong to the session of the URL (else 404, nothing is written). */
async function itemOfSession(
	locals: App.Locals,
	session: ImportSession,
	itemId: string
): Promise<'ok' | 'missing' | 'error'> {
	const item = await getImportItem(locals.supabase, itemId);
	if (item.error) {
		console.error('[imports] row lookup failed', {
			requestId: locals.requestId,
			itemId,
			error: item.error
		});
		return 'error';
	}
	return item.data && item.data.sessionId === session.id ? 'ok' : 'missing';
}

const ctxOf = (locals: App.Locals) => ({
	requestId: locals.requestId,
	permissions: locals.permissions
});

/** First message per field of a zod error. */
function fieldErrors(issues: readonly { path: PropertyKey[]; message: string }[]) {
	const errors: Record<string, string[]> = {};
	for (const issue of issues) {
		const key = String(issue.path[0] ?? 'form');
		(errors[key] ??= []).push(`${issue.message}.`.replace(/\.\.$/, '.'));
	}
	return errors;
}

export const actions: Actions = {
	/** Retype the fields of one row (also clears a parser error) and revalidate. */
	update: async (event) => {
		const found = await sessionForAction(event, 'update', { openCampaign: true });
		if ('failure' in found) return found.failure;

		const formData = await event.request.formData();
		const values = {
			itemType: textField(formData, 'itemType') ?? '',
			groupKey: textField(formData, 'groupKey') ?? '',
			baseNumber: textField(formData, 'baseNumber') ?? '',
			barcode: textField(formData, 'barcode') ?? ''
		};
		const itemId = textField(formData, 'itemId') ?? '';
		const parsed = importUpdateItemSchema.safeParse({ itemId, ...values });
		if (!parsed.success) {
			const errors = fieldErrors(parsed.error.issues);
			if (errors.itemId) return importFormFailure('update', 404, IMPORT_MESSAGES.itemNotFound);
			return importFormFailure('update', 400, FIX_FIELDS, { errors, itemId, values });
		}
		const owned = await itemOfSession(event.locals, found.session, itemId);
		if (owned !== 'ok') {
			return owned === 'error'
				? importFormFailure('update', 500, IMPORT_MESSAGES.internal, { itemId, values })
				: importFormFailure('update', 404, IMPORT_MESSAGES.itemNotFound, { itemId });
		}

		try {
			const summary = await updateImportItem(
				event.locals.supabase,
				parsed.data,
				ctxOf(event.locals)
			);
			const result: ImportFormResult = {
				form: 'update',
				success: true,
				message: 'Row corrected and revalidated.',
				itemId,
				summary
			};
			return result;
		} catch (err) {
			return importServiceFailure('update', err, { itemId, values });
		}
	},

	/** Soft-remove a row (kept as history) and revalidate. */
	remove: async (event) => {
		const found = await sessionForAction(event, 'remove', { openCampaign: true });
		if ('failure' in found) return found.failure;
		const formData = await event.request.formData();
		const itemId = textField(formData, 'itemId') ?? '';
		const reason = textField(formData, 'reason');
		if (!isUuid(itemId)) return importFormFailure('remove', 404, IMPORT_MESSAGES.itemNotFound);
		const owned = await itemOfSession(event.locals, found.session, itemId);
		if (owned !== 'ok') {
			return owned === 'error'
				? importFormFailure('remove', 500, IMPORT_MESSAGES.internal, { itemId })
				: importFormFailure('remove', 404, IMPORT_MESSAGES.itemNotFound, { itemId });
		}
		if (reason && reason.length > IMPORT_REASON_MAX_LENGTH) {
			return importFormFailure(
				'remove',
				400,
				`Reasons are limited to ${IMPORT_REASON_MAX_LENGTH} characters.`,
				{ itemId }
			);
		}
		try {
			const summary = await removeImportItem(
				event.locals.supabase,
				{ itemId, reason },
				ctxOf(event.locals)
			);
			const result: ImportFormResult = {
				form: 'remove',
				success: true,
				message: 'Row removed from the import.',
				itemId,
				summary
			};
			return result;
		} catch (err) {
			return importServiceFailure('remove', err, { itemId });
		}
	},

	validate: async (event) => {
		const found = await sessionForAction(event, 'validate');
		if ('failure' in found) return found.failure;
		try {
			const summary = await validateImportSession(
				event.locals.supabase,
				found.session.id,
				ctxOf(event.locals)
			);
			const result: ImportFormResult = {
				form: 'validate',
				success: summary.status === 'validated',
				message:
					summary.status === 'validated'
						? 'The import is valid and ready to confirm.'
						: 'Some rows still need attention: correct or remove them and validate again.',
				summary
			};
			return result;
		} catch (err) {
			return importServiceFailure('validate', err);
		}
	},

	/** Create the bonds; on success reload the preview with a confirmation banner. */
	confirm: async (event) => {
		const found = await sessionForAction(event, 'confirm');
		if ('failure' in found) return found.failure;
		let outcome;
		try {
			outcome = await confirmImportSession(
				event.locals.supabase,
				found.session.id,
				ctxOf(event.locals)
			);
		} catch (err) {
			return importServiceFailure('confirm', err);
		}
		if (!outcome.confirmed) {
			return importFormFailure('confirm', 409, IMPORT_CONFIRM_MESSAGES.stale, {
				summary: outcome.summary
			});
		}
		redirect(303, `${event.url.pathname}?confirmed=1`);
	},

	cancel: async (event) => {
		const found = await sessionForAction(event, 'cancel');
		if ('failure' in found) return found.failure;
		const formData = await event.request.formData();
		const reason = textField(formData, 'reason');
		if (reason && reason.length > IMPORT_REASON_MAX_LENGTH) {
			return importFormFailure(
				'cancel',
				400,
				`Reasons are limited to ${IMPORT_REASON_MAX_LENGTH} characters.`
			);
		}
		try {
			await cancelImportSession(
				event.locals.supabase,
				{ sessionId: found.session.id, reason },
				ctxOf(event.locals)
			);
		} catch (err) {
			return importServiceFailure('cancel', err);
		}
		const result: ImportFormResult = {
			form: 'cancel',
			success: true,
			message: 'The import was cancelled. No bond was created.'
		};
		return result;
	},

	/** Annul every bond of a confirmed import (admin, `bond.annul`, reason required). */
	rollback: async (event) => {
		const found = await sessionForAction(event, 'rollback');
		if ('failure' in found) return found.failure;
		const formData = await event.request.formData();
		const reasonText = textField(formData, 'reason') ?? '';
		const values = { reason: reasonText };
		const parsed = importRollbackSchema.safeParse({
			sessionId: found.session.id,
			reason: reasonText
		});
		if (!parsed.success) {
			const errors = fieldErrors(parsed.error.issues);
			return importFormFailure('rollback', 400, errors.reason?.[0] ?? FIX_FIELDS, {
				errors,
				values
			});
		}
		try {
			await rollBackImportSession(event.locals.supabase, parsed.data, ctxOf(event.locals));
		} catch (err) {
			if (err instanceof ImportServiceError && err.kind === 'permission') {
				return importFormFailure('rollback', 403, IMPORT_MESSAGES.permission);
			}
			return importServiceFailure('rollback', err, { values });
		}
		const result: ImportFormResult = {
			form: 'rollback',
			success: true,
			message: 'The import was rolled back: its bonds were annulled and their numbers released.'
		};
		return result;
	}
};

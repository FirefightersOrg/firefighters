import { error, fail } from '@sveltejs/kit';
import { z } from 'zod';
import type { Campaign } from '$lib/domain/campaigns';
import type { ImportItem } from '$lib/server/repositories/imports';
import { requireActiveUser } from '$lib/server/auth/guards';
import { hasPermissionIn } from '$lib/server/auth/permissions';
import type { PermissionCode } from '$lib/server/auth/permission-codes';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import {
	IMPORT_MESSAGES,
	ImportServiceError,
	type ImportSessionSummary
} from '$lib/server/services/imports';

/** Which form of the import screens an action result belongs to. */
export type ImportFormName =
	| 'upload'
	| 'start'
	| 'scan'
	| 'update'
	| 'remove'
	| 'validate'
	| 'confirm'
	| 'cancel'
	| 'rollback';

/** Shape of every import action result (success or `fail()` data). */
export interface ImportFormResult {
	form: ImportFormName;
	success: boolean;
	message: string;
	/** Field errors of the form (`baseNumber`, `barcode`, …). */
	errors?: Record<string, string[]>;
	/** The row the action was about (edit/remove forms). */
	itemId?: string;
	/** The preview counts after the action, when it changed them. */
	summary?: ImportSessionSummary;
	/** The scan just staged, for the scanner's feedback. */
	scanned?: ImportItem | null;
	/** Submitted values, to refill the form when JavaScript is off. */
	values?: Record<string, string>;
}

export const isUuid = (value: string) => z.guid().safeParse(value).success;

export function importFormFailure(
	form: ImportFormName,
	status: number,
	message: string,
	extra: Omit<ImportFormResult, 'form' | 'success' | 'message'> = {}
) {
	const data: ImportFormResult = { form, success: false, message, ...extra };
	return fail(status, data);
}

/**
 * Actions: active user (else redirect to login). Returns a 403 `fail()` result when the
 * permission is missing, or null when the action may proceed. The SQL function re-checks.
 */
export function checkImportActionPermission(
	locals: App.Locals,
	url: URL,
	form: ImportFormName,
	permission: PermissionCode
) {
	requireActiveUser(locals, url.pathname);
	if (!hasPermissionIn(locals.permissions, permission)) {
		return importFormFailure(form, 403, IMPORT_MESSAGES.permission);
	}
	return null;
}

/** Maps an `ImportServiceError` to a `fail()` result; other errors are rethrown. */
export function importServiceFailure(
	form: ImportFormName,
	err: unknown,
	extra: Omit<ImportFormResult, 'form' | 'success' | 'message'> = {}
) {
	if (!(err instanceof ImportServiceError)) throw err;
	return importFormFailure(form, err.status, err.message, extra);
}

/** Loads the campaign of the route (404 for a malformed or unknown id, 500 on failure). */
export async function loadImportCampaign(locals: App.Locals, id: string): Promise<Campaign> {
	if (!isUuid(id)) error(404, { message: IMPORT_MESSAGES.campaignNotFound });
	const result = await getCampaignById(locals.supabase, id);
	if (result.error) {
		console.error('[imports] campaign load failed', {
			requestId: locals.requestId,
			campaignId: id,
			error: result.error
		});
		error(500, { message: 'No se pudo cargar la campaña. Volver a intentar.' });
	}
	if (!result.data) error(404, { message: IMPORT_MESSAGES.campaignNotFound });
	return result.data;
}

/** Trimmed text field of a form, or null when empty. */
export function textField(formData: FormData, name: string): string | null {
	const value = formData.get(name);
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed === '' ? null : trimmed;
}

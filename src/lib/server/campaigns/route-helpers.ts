import { fail } from '@sveltejs/kit';
import type { z } from 'zod';
import { requireActiveUser } from '$lib/server/auth/guards';
import { hasPermissionIn, requirePermissionIn } from '$lib/server/auth/permissions';
import type { PermissionCode } from '$lib/server/auth/permission-codes';
import { campaignFieldErrors, type CampaignFieldErrors } from '$lib/schemas/campaign';
import { CAMPAIGN_MESSAGES, CampaignServiceError } from '$lib/server/services/campaigns';

/** Which form on a campaign page an action result belongs to. */
export type CampaignFormName = 'create' | 'general' | 'rules' | 'transition';

/** Shape of every campaign form action result (success or `fail()` data). */
export interface CampaignFormResult {
	form: CampaignFormName;
	success: boolean;
	message: string;
	errors: CampaignFieldErrors;
	/** Submitted values, to refill the form when JavaScript is off. */
	values?: Record<string, string>;
}

/** Loads: active user (else redirect to login) with `campaign.view` (else 403). */
export function requireCampaignViewer(locals: App.Locals, url: URL) {
	const profile = requireActiveUser(locals, url.pathname + url.search);
	requirePermissionIn(locals.permissions, 'campaign.view');
	return profile;
}

/**
 * Actions: active user (else redirect to login). Returns a 403 `fail()` result when the
 * permission is missing, or null when the action may proceed. The SQL function re-checks.
 */
export function checkCampaignActionPermission(
	locals: App.Locals,
	url: URL,
	form: CampaignFormName,
	permission: PermissionCode
) {
	requireActiveUser(locals, url.pathname);
	if (!hasPermissionIn(locals.permissions, permission)) {
		return campaignFormFailure(form, 403, CAMPAIGN_MESSAGES.permission);
	}
	return null;
}

export function campaignFormFailure(
	form: CampaignFormName,
	status: number,
	message: string,
	extra: { errors?: CampaignFieldErrors; values?: Record<string, string> } = {}
) {
	const data: CampaignFormResult = {
		form,
		success: false,
		message,
		errors: extra.errors ?? {},
		values: extra.values
	};
	return fail(status, data);
}

export function campaignFormSuccess(form: CampaignFormName, message: string): CampaignFormResult {
	return { form, success: true, message, errors: {} };
}

export const FIX_FIELDS_MESSAGE = 'Please correct the highlighted fields.';

/** 400 failure for a schema validation error. */
export function campaignValidationFailure(
	form: CampaignFormName,
	error: z.ZodError,
	values: Record<string, string>
) {
	return campaignFormFailure(form, 400, FIX_FIELDS_MESSAGE, {
		errors: campaignFieldErrors(error),
		values
	});
}

/** Maps an error thrown by the campaign service to a `fail()` result. Other errors are rethrown. */
export function campaignServiceFailure(
	form: CampaignFormName,
	err: unknown,
	values?: Record<string, string>
) {
	if (!(err instanceof CampaignServiceError)) throw err;
	if (err.field) {
		return campaignFormFailure(form, err.status, FIX_FIELDS_MESSAGE, {
			errors: { [err.field]: [err.message] },
			values
		});
	}
	return campaignFormFailure(form, err.status, err.message, { values });
}

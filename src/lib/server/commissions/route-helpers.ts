import { fail } from '@sveltejs/kit';
import type { z } from 'zod';
import { requireActiveUser } from '$lib/server/auth/guards';
import { hasPermissionIn, permissionsUnavailable } from '$lib/server/auth/permissions';
import {
	COMMISSION_RULE_VERSION_FIELD,
	commissionRuleFieldErrors,
	type CommissionRuleFieldErrors
} from '$lib/schemas/commission-rule';
import {
	COMMISSION_RULE_MESSAGES,
	CommissionRuleServiceError
} from '$lib/server/services/commission-rules';

/** Which form on the commission rules page an action result belongs to. */
export type CommissionRuleFormName = 'create' | 'update' | 'annul';

/** Shape of every commission rule form action result (success or `fail()` data). */
export interface CommissionRuleFormResult {
	form: CommissionRuleFormName;
	success: boolean;
	message: string;
	errors: CommissionRuleFieldErrors;
	/** The rule the result is about (update / annul), when known. */
	ruleId?: string;
	/** Submitted values, to refill the form when JavaScript is off. */
	values?: Record<string, string>;
}

export const FIX_FIELDS_MESSAGE = 'Please correct the highlighted fields.';

/**
 * Actions: active user (else redirect to login). Returns a 403 `fail()` result without
 * `commission.rule_manage`, or null when the action may proceed. The SQL function re-checks.
 */
export function checkCommissionRuleManager(
	locals: App.Locals,
	url: URL,
	form: CommissionRuleFormName
) {
	requireActiveUser(locals, url.pathname);
	if (permissionsUnavailable(locals.permissions)) {
		// Loading the permissions failed (logged by the hook): an outage, not a denial.
		return commissionRuleFormFailure(form, 500, COMMISSION_RULE_MESSAGES.internal);
	}
	if (!hasPermissionIn(locals.permissions, 'commission.rule_manage')) {
		return commissionRuleFormFailure(form, 403, COMMISSION_RULE_MESSAGES.permission);
	}
	return null;
}

export function commissionRuleFormFailure(
	form: CommissionRuleFormName,
	status: number,
	message: string,
	extra: {
		errors?: CommissionRuleFieldErrors;
		values?: Record<string, string>;
		ruleId?: string;
	} = {}
) {
	const data: CommissionRuleFormResult = {
		form,
		success: false,
		message,
		errors: extra.errors ?? {},
		ruleId: extra.ruleId,
		values: extra.values
	};
	return fail(status, data);
}

export function commissionRuleFormSuccess(
	form: CommissionRuleFormName,
	message: string,
	ruleId?: string
): CommissionRuleFormResult {
	return { form, success: true, message, errors: {}, ruleId };
}

/**
 * 400 failure for a schema validation error. A missing or malformed version (the hidden
 * `expectedUpdatedAt` field, which has no visible input) is reported as the form message.
 */
export function commissionRuleValidationFailure(
	form: CommissionRuleFormName,
	error: z.ZodError,
	values: Record<string, string>,
	ruleId?: string
) {
	const errors = commissionRuleFieldErrors(error);
	const message = errors[COMMISSION_RULE_VERSION_FIELD]?.[0] ?? FIX_FIELDS_MESSAGE;
	return commissionRuleFormFailure(form, 400, message, { errors, values, ruleId });
}

/** Maps an error thrown by the commission rule service to a `fail()` result. Others rethrow. */
export function commissionRuleServiceFailure(
	form: CommissionRuleFormName,
	err: unknown,
	values?: Record<string, string>,
	ruleId?: string
) {
	if (!(err instanceof CommissionRuleServiceError)) throw err;
	if (err.field) {
		return commissionRuleFormFailure(form, err.status, FIX_FIELDS_MESSAGE, {
			errors: { [err.field]: [err.message] },
			values,
			ruleId
		});
	}
	return commissionRuleFormFailure(form, err.status, err.message, { values, ruleId });
}

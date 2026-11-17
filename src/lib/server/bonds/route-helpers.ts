import { fail } from '@sveltejs/kit';
import type { z } from 'zod';
import { CAMPAIGN_STATUS_LABELS, type CampaignStatus } from '$lib/domain/campaigns';
import { requireActiveUser } from '$lib/server/auth/guards';
import { hasPermissionIn } from '$lib/server/auth/permissions';
import type { PermissionCode } from '$lib/server/auth/permission-codes';
import { bondFieldErrors, type BondFieldErrors } from '$lib/schemas/bond';
import {
	BOND_MESSAGES,
	BondServiceError,
	type BondNumberConflict
} from '$lib/server/services/bonds';

/** Which bond form an action result belongs to. */
export type BondFormName = 'create';

/**
 * A bond that already uses a number or code of the submitted form. `numbers` are padded like the
 * campaign shows them; empty for a duplicate internal code or barcode. The page shows the numbers
 * as text for now; `bondId` is kept so the form can link to the bond's record
 * (`/campaigns/[id]/bonds/[bondId]`) once that route exists (SAN-25).
 */
export interface BondConflictLink {
	field: string;
	bondId: string;
	numbers: string[];
}

/** The bond just created, for the confirmation of "Save & add another". */
export interface CreatedBondSummary {
	id: string;
	baseFormatted: string;
	associatedFormatted: string;
}

/** Shape of every bond form action result (success or `fail()` data). */
export interface BondFormResult {
	form: BondFormName;
	success: boolean;
	message: string;
	errors: BondFieldErrors;
	/** Bonds that already use a submitted number or code. */
	conflicts?: BondConflictLink[];
	/** On success: the bond just created. */
	created?: CreatedBondSummary;
	/** Submitted values, to refill the form when JavaScript is off. */
	values?: Record<string, string>;
}

export const FIX_FIELDS_MESSAGE = 'Please correct the highlighted fields.';

/**
 * Actions: active user (else redirect to login). Returns a 403 `fail()` result when the
 * permission is missing, or null when the action may proceed. The SQL function re-checks.
 */
export function checkBondActionPermission(
	locals: App.Locals,
	url: URL,
	form: BondFormName,
	permission: PermissionCode
) {
	requireActiveUser(locals, url.pathname);
	if (!hasPermissionIn(locals.permissions, permission)) {
		return bondFormFailure(form, 403, BOND_MESSAGES.permission);
	}
	return null;
}

export function bondFormFailure(
	form: BondFormName,
	status: number,
	message: string,
	extra: {
		errors?: BondFieldErrors;
		conflicts?: BondConflictLink[];
		values?: Record<string, string>;
	} = {}
) {
	const data: BondFormResult = {
		form,
		success: false,
		message,
		errors: extra.errors ?? {},
		conflicts: extra.conflicts,
		values: extra.values
	};
	return fail(status, data);
}

/** "Bonds can only be loaded or changed while ... This campaign is closed." */
export function campaignLockedMessage(status: CampaignStatus): string {
	return `${BOND_MESSAGES.campaignLocked} This campaign is ${CAMPAIGN_STATUS_LABELS[status].toLowerCase()}.`;
}

/** 400 failure for a schema validation error. */
export function bondValidationFailure(
	form: BondFormName,
	error: z.ZodError,
	values: Record<string, string>
) {
	return bondFormFailure(form, 400, FIX_FIELDS_MESSAGE, { errors: bondFieldErrors(error), values });
}

/** Duplicate numbers grouped by the bond that uses them, in the order reported. */
export function conflictLinks(
	field: string,
	conflicts: readonly BondNumberConflict[]
): BondConflictLink[] {
	const byBond = new Map<string, BondConflictLink>();
	for (const conflict of conflicts) {
		const link = byBond.get(conflict.bondId) ?? { field, bondId: conflict.bondId, numbers: [] };
		link.numbers.push(conflict.formatted);
		byBond.set(conflict.bondId, link);
	}
	return [...byBond.values()];
}

/**
 * "Number 0068 is already used by another bond in this campaign." The bond is not named by its id
 * (meaningless to people).
 */
export function duplicateNumbersFieldMessage(conflicts: readonly BondNumberConflict[]): string {
	const numbers = conflicts.map((c) => c.formatted);
	const owners = new Set(conflicts.map((c) => c.bondId)).size;
	const subject =
		numbers.length === 1 ? `Number ${numbers[0]} is` : `Numbers ${numbers.join(', ')} are`;
	return `${subject} already used by ${owners === 1 ? 'another bond' : 'other bonds'} in this campaign.`;
}

const BOND_ID_REFERENCE = / by bond [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Maps an error thrown by the bond service to a `fail()` result: field errors (with the bonds that
 * already use a number or code, as `conflicts`) or a form message. Other errors are rethrown.
 */
export function bondServiceFailure(
	form: BondFormName,
	err: unknown,
	values?: Record<string, string>
) {
	if (!(err instanceof BondServiceError)) throw err;

	if (err.field && err.conflicts.length > 0) {
		return bondFormFailure(form, err.status, FIX_FIELDS_MESSAGE, {
			errors: { [err.field]: [duplicateNumbersFieldMessage(err.conflicts)] },
			conflicts: conflictLinks(err.field, err.conflicts),
			values
		});
	}
	if (err.field) {
		const bondId = err.kind === 'conflict' ? err.conflictingBondId : undefined;
		const message = bondId
			? err.message.replace(BOND_ID_REFERENCE, ' by another bond in this campaign')
			: err.message;
		return bondFormFailure(form, err.status, FIX_FIELDS_MESSAGE, {
			errors: { [err.field]: [message] },
			conflicts: bondId ? [{ field: err.field, bondId, numbers: [] }] : [],
			values
		});
	}
	return bondFormFailure(form, err.status, err.message, { values });
}

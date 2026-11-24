import { fail } from '@sveltejs/kit';
import type { z } from 'zod';
import type { CampaignStatus } from '$lib/domain/campaigns';
import { requireActiveUser } from '$lib/server/auth/guards';
import { hasPermissionIn, permissionsUnavailable } from '$lib/server/auth/permissions';
import type { PermissionCode } from '$lib/server/auth/permission-codes';
import { bondFieldErrors, type BondFieldErrors } from '$lib/schemas/bond';
import {
	BOND_MESSAGES,
	BondServiceError,
	campaignStatusLabel,
	type BondNumberConflict
} from '$lib/server/services/bonds';

/**
 * Which bond form an action result belongs to: simple bond entry (`create`), printed pata
 * (`pata`), manual grouping (`group`), and the bond record actions (`ungroup`, `annul`).
 */
export type BondFormName = 'create' | 'pata' | 'group' | 'ungroup' | 'annul';

/**
 * A bond that already uses a number or code of the submitted form, to link to its record
 * (`/campaigns/[id]/bonds/[bondId]`). `numbers` are padded like the campaign shows them; empty
 * for a duplicate internal code or barcode.
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

export const FIX_FIELDS_MESSAGE = 'Corregir los campos marcados.';

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
	if (permissionsUnavailable(locals.permissions)) {
		// Loading the permissions failed (logged by the hook): an outage, not a denial.
		return bondFormFailure(form, 500, BOND_MESSAGES.internal);
	}
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

/** "Los bonos solo se pueden cargar o modificar mientras ... La campaña está cerrada." */
export function campaignLockedMessage(status: CampaignStatus): string {
	return `${BOND_MESSAGES.campaignLocked} La campaña está ${campaignStatusLabel(status)}.`;
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
 * "El número 0068 ya está en uso en otro bono de esta campaña." The bond is not named by its id
 * (meaningless to people): the form links to it instead.
 */
export function duplicateNumbersFieldMessage(conflicts: readonly BondNumberConflict[]): string {
	const numbers = conflicts.map((c) => c.formatted);
	const owners = new Set(conflicts.map((c) => c.bondId)).size;
	const subject =
		numbers.length === 1 ? `El número ${numbers[0]} ya está` : `Los números ${numbers.join(', ')} ya están`;
	return `${subject} en uso en ${owners === 1 ? 'otro bono' : 'otros bonos'} de esta campaña.`;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const BOND_ID_REFERENCE = new RegExp(` en el bono ${UUID}`, 'i');

/**
 * Removes bond ids (meaningless to people) from a database message: `El bono 0068 (<id>) ...`
 * → `El bono 0068 ...`; `... la pata manual <id>` → `... una pata manual`;
 * `(la pata <id> está ...)` → `(esta pata está ...)`; `El bono <id> figura ...` → `Un bono figura ...`.
 */
export function withoutBondIds(message: string): string {
	return message
		.replace(new RegExp(` \\(${UUID}\\)`, 'gi'), '')
		.replace(new RegExp(`la pata manual ${UUID}`, 'gi'), 'una pata manual')
		.replace(new RegExp(`\\bla pata ${UUID}`, 'gi'), 'esta pata')
		.replace(new RegExp(`\\b(e)l bono ${UUID}`, 'gi'), (_match, e: string) =>
			e === 'E' ? 'Un bono' : 'un bono'
		);
}

/**
 * Maps an error thrown by the bond service to a `fail()` result: field errors (with links to the
 * bonds that already use a number or code) or a form message. Other errors are rethrown.
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
		const message = withoutBondIds(
			bondId
				? err.message.replace(BOND_ID_REFERENCE, ' en otro bono de esta campaña')
				: err.message
		);
		return bondFormFailure(form, err.status, FIX_FIELDS_MESSAGE, {
			errors: { [err.field]: [message] },
			conflicts: bondId ? [{ field: err.field, bondId, numbers: [] }] : [],
			values
		});
	}
	return bondFormFailure(form, err.status, withoutBondIds(err.message), { values });
}

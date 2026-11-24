import type { SupabaseClient } from '@supabase/supabase-js';
import {
	BOND_COMMERCIAL_STATUSES,
	BOND_COMMERCIAL_STATUS_LABELS,
	type BondCommercialStatus,
	type BondNumberKind
} from '$lib/domain/bonds';
import { CAMPAIGN_STATUS_LABELS, type CampaignStatus } from '$lib/domain/campaigns';
import { hasPermissionIn } from '$lib/server/auth/permissions';
import type { PermissionCode } from '$lib/server/auth/permission-codes';
import type {
	BondAnnulInput,
	BondCreateInput,
	BondFormField,
	BondGroupInput,
	BondUngroupInput
} from '$lib/schemas/bond';

/**
 * Bond use cases. Every write calls one audited SQL function with the USER-SCOPED client
 * (`locals.supabase`), so the database checks the caller's active profile and permission, locks
 * the campaign, validates and writes the change plus its `audit_log` row in one transaction
 * (migration `20261120000000_bond_rpcs.sql`).
 *
 * When the request's permission list is passed (`ctx.permissions`, i.e. `locals.permissions`),
 * the permission is also checked up front with `hasPermissionIn`, so a forbidden call fails
 * without a round trip; the database check stays authoritative.
 *
 * Errors are thrown as `BondServiceError` with a kind the routes map to HTTP statuses and a
 * message that is safe to show to the user. Duplicate numbers carry every conflict
 * (`conflicts`: number, padded number, bond id) so the UI can link to the bond that uses it.
 */

export type BondErrorKind = 'validation' | 'permission' | 'conflict' | 'not_found' | 'internal';

const STATUS_BY_KIND: Record<BondErrorKind, number> = {
	validation: 400,
	permission: 403,
	not_found: 404,
	conflict: 409,
	internal: 500
};

/** A participating number already used by another bond of the campaign. */
export interface BondNumberConflict {
	number: number;
	/** Padded to the campaign's digit count (`0068`). */
	formatted: string;
	bondId: string;
	/** Role of the number in the bond that already uses it. */
	numberKind: BondNumberKind;
}

export class BondServiceError extends Error {
	readonly kind: BondErrorKind;
	/** Form field the error belongs to, when it can be attributed to one. */
	readonly field?: BondFormField;
	/** Duplicate numbers (23505), when the database reported them. */
	readonly conflicts: BondNumberConflict[];
	/** Bond that already uses a duplicate code, when the database reported it. */
	readonly conflictingBondId?: string;

	constructor(
		kind: BondErrorKind,
		message: string,
		options?: {
			field?: BondFormField;
			cause?: unknown;
			conflicts?: BondNumberConflict[];
			conflictingBondId?: string;
		}
	) {
		super(message, { cause: options?.cause });
		this.name = 'BondServiceError';
		this.kind = kind;
		this.field = options?.field;
		this.conflicts = options?.conflicts ?? [];
		this.conflictingBondId = options?.conflictingBondId ?? this.conflicts[0]?.bondId;
	}

	/** HTTP status for this error (400, 403, 404, 409 or 500). */
	get status(): number {
		return STATUS_BY_KIND[this.kind];
	}
}

interface PostgrestLikeError {
	code?: string;
	message: string;
	details?: string | null;
	hint?: string | null;
}

export const BOND_MESSAGES = {
	permission: 'No hay permiso para realizar esta acción.',
	campaignNotFound: 'No se encontró la campaña.',
	bondNotFound: 'No se encontró el bono. Puede que se haya quitado o que no haya acceso a él.',
	internal: 'Algo salió mal. Volver a intentar.',
	invalid: 'Hay valores no válidos. Revisar el formulario.',
	campaignLocked:
		'Los bonos solo se pueden cargar o modificar mientras la campaña es un borrador o está activa.',
	manualPataAnnul:
		'Una pata agrupada manualmente no se puede anular directamente. Desagruparla en su lugar.',
	duplicate: 'Un número o código ya está en uso en otro bono de esta campaña.'
} as const;

/** Which form field a duplicate-number error belongs to (simple bond or pata form). */
export type BondNumberField = 'baseNumber' | 'baseNumbers';

const STATUS_WORD = new RegExp(`\\b(${BOND_COMMERCIAL_STATUSES.join('|')})\\b`, 'g');

/** A bond status code as a lowercase Spanish word (`sold` → `vendido`). */
function statusLabel(status: string): string {
	return (BOND_COMMERCIAL_STATUS_LABELS[status as BondCommercialStatus] ?? status).toLowerCase();
}

/** A campaign status code as a lowercase Spanish word (`closed` → `cerrada`). */
export function campaignStatusLabel(status: string): string {
	return (CAMPAIGN_STATUS_LABELS[status as CampaignStatus] ?? status).toLowerCase();
}

/**
 * The database raises English messages; these are their Spanish wording (docs/copy.md). The
 * first matching pattern wins; unknown messages fall back to the original text.
 */
const DB_MESSAGES_ES: [RegExp, (m: RegExpExecArray) => string][] = [
	[/^an active profile is required/, () => 'Se requiere un perfil activo para modificar bonos'],
	[/^at least one base number is required/, () => 'Se requiere al menos un número base'],
	[/^base numbers (must be a flat list|cannot be empty)/, () => 'Los números base no son válidos'],
	[/^base number (\S+) is negative/, (m) => `El número base ${m[1]} no puede ser negativo`],
	[
		/^number (\S+) exceeds the campaign maximum number (\S+)/,
		(m) => `El número ${m[1]} supera el número máximo de la campaña ${m[2]}`
	],
	[
		/^base number (\S+) overflows: its associated number (\S+) exceeds the campaign maximum number (\S+)/,
		(m) =>
			`El número base ${m[1]} desborda: su número asociado ${m[2]} supera el número máximo de la campaña ${m[3]}`
	],
	[
		/^number (\S+) appears more than once in this bond \((\d+) as base, (\d+) as associated\)/,
		(m) =>
			`El número ${m[1]} aparece más de una vez en este bono (${m[2]} como base, ${m[3]} como asociado)`
	],
	[
		/^number (\S+) is already used by bond (\S+)/,
		(m) => `El número ${m[1]} ya está en uso en el bono ${m[2]}`
	],
	[
		/^internal code (.+) is already used by bond (\S+)/,
		(m) => `El código interno ${m[1]} ya está en uso en el bono ${m[2]}`
	],
	[
		/^barcode (.+) is already used by bond (\S+)/,
		(m) => `El código de barras ${m[1]} ya está en uso en el bono ${m[2]}`
	],
	[
		/^a pata needs at least (\d+) simple bonds/,
		(m) => `Una pata necesita al menos ${m[1]} bonos simples`
	],
	[/^member bond ids cannot be empty/, () => 'Se requiere elegir los bonos que forman la pata'],
	[/^bond (\S+) is listed more than once/, (m) => `El bono ${m[1]} figura más de una vez`],
	[/^bond (.+) not found/, () => BOND_MESSAGES_NOT_FOUND],
	[/^bond (.+) belongs to another campaign/, (m) => `El bono ${m[1]} pertenece a otra campaña`],
	[
		/^only simple bonds can be grouped into a pata \(bond (.+) is a (\w+)\)/,
		(m) => `Solo se pueden agrupar bonos simples en una pata (el bono ${m[1]} es una pata)`
	],
	[
		/^only available bonds can be grouped \(bond (.+) is (\w+)\)/,
		(m) =>
			`Solo se pueden agrupar bonos disponibles (el bono ${m[1]} está en estado ${statusLabel(m[2])})`
	],
	[
		/^bond (.+) already belongs to manually grouped pata (\S+)/,
		(m) => `El bono ${m[1]} ya pertenece a la pata manual ${m[2]}`
	],
	[
		/^a reason is required to ungroup a pata/,
		() => 'Se requiere un motivo para desagrupar una pata'
	],
	[/^a reason is required to annul a bond/, () => 'Se requiere un motivo para anular un bono'],
	[
		/^bond (\S+) is not a manually grouped pata/,
		(m) => `El bono ${m[1]} no es una pata agrupada manualmente`
	],
	[
		/^only an available pata can be ungrouped \(pata (\S+) is (\w+)\)/,
		(m) =>
			`Solo se puede desagrupar una pata disponible (la pata ${m[1]} está en estado ${statusLabel(m[2])})`
	],
	[/^bond (.+) is already annulled/, (m) => `El bono ${m[1]} ya está anulado`],
	[
		/^only available bonds can be annulled \(bond (.+) is (\w+)\)/,
		(m) =>
			`Solo se pueden anular bonos disponibles (el bono ${m[1]} está en estado ${statusLabel(m[2])})`
	],
	[
		/^bond (.+) belongs to manually grouped pata (\S+)/,
		(m) => `El bono ${m[1]} pertenece a la pata manual ${m[2]}`
	]
];
const BOND_MESSAGES_NOT_FOUND = 'No se encontró el bono.';

/** Database message → sentence for people: Spanish, capitalized, final period. */
function humanize(message: string): string {
	let text = message;
	for (const [pattern, translate] of DB_MESSAGES_ES) {
		const match = pattern.exec(message);
		if (match) {
			text = translate(match);
			break;
		}
	}
	if (text === message) text = message.replace(STATUS_WORD, (status) => statusLabel(status));
	const sentence = text.charAt(0).toUpperCase() + text.slice(1);
	return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

function parseDetails(details: string | null | undefined): Record<string, unknown> | null {
	if (!details) return null;
	try {
		const parsed: unknown = JSON.parse(details);
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

function parseConflicts(details: Record<string, unknown> | null): BondNumberConflict[] {
	const raw = details?.conflicts;
	if (!Array.isArray(raw)) return [];
	return raw.flatMap((entry) => {
		const c = entry as Record<string, unknown>;
		return typeof c.number === 'number' &&
			typeof c.formatted === 'string' &&
			typeof c.bond_id === 'string'
			? [
					{
						number: c.number,
						formatted: c.formatted,
						bondId: c.bond_id,
						numberKind: (c.number_kind as BondNumberKind) ?? 'base'
					}
				]
			: [];
	});
}

/**
 * "Number 0068 is already used by bond X." / "Numbers 0068, 4939 are already used by bond X." (the
 * usual case: the same bond entered twice) / "... are already used by other bonds in this
 * campaign (0068: bond X, 5000: bond Y)."
 */
export function duplicateNumbersMessage(conflicts: readonly BondNumberConflict[]): string {
	const numbers = conflicts.map((c) => c.formatted).join(', ');
	const bonds = [...new Set(conflicts.map((c) => c.bondId))];
	if (conflicts.length === 1) {
		return `El número ${numbers} ya está en uso en el bono ${bonds[0]}.`;
	}
	if (bonds.length === 1) {
		return `Los números ${numbers} ya están en uso en el bono ${bonds[0]}.`;
	}
	const owners = conflicts.map((c) => `${c.formatted}: bono ${c.bondId}`).join(', ');
	return `Los números ${numbers} ya están en uso en otros bonos de esta campaña (${owners}).`;
}

/** Field of a 22023 / 55000 message, by its wording (see the migration's RAISE messages). */
function fieldFor(message: string, numberField: BondNumberField): BondFormField | undefined {
	if (/base number|^number |appears more than once/.test(message)) return numberField;
	if (
		/pata needs at least|member bond ids|listed more than once|another campaign|only simple bonds|already belongs to manually grouped pata|only available bonds can be grouped/.test(
			message
		)
	) {
		return 'memberBondIds';
	}
	if (message.startsWith('a reason is required')) return 'reason';
	if (message.includes('is not a manually grouped pata')) return 'pataBondId';
	return undefined;
}

/** Maps a PostgREST/Postgres error from a `bond_*` function to a `BondServiceError`. */
export function mapBondRpcError(
	rpcError: PostgrestLikeError,
	options: { numberField?: BondNumberField } = {}
): BondServiceError {
	const message = rpcError.message ?? '';
	const numberField = options.numberField ?? 'baseNumbers';
	const err = (
		kind: BondErrorKind,
		text: string,
		extra?: { field?: BondFormField; conflicts?: BondNumberConflict[]; conflictingBondId?: string }
	) => new BondServiceError(kind, text, { ...extra, cause: rpcError });

	switch (rpcError.code) {
		case '42501':
			return err('permission', BOND_MESSAGES.permission);

		case 'P0002':
			return message.startsWith('campaign')
				? err('not_found', BOND_MESSAGES.campaignNotFound)
				: err('not_found', BOND_MESSAGES.bondNotFound);

		case '22023':
			return err('validation', humanize(message), { field: fieldFor(message, numberField) });

		case '23505': {
			const details = parseDetails(rpcError.details);
			const conflicts = parseConflicts(details);
			if (conflicts.length > 0) {
				return err('conflict', duplicateNumbersMessage(conflicts), {
					field: numberField,
					conflicts
				});
			}
			const bondId = typeof details?.bond_id === 'string' ? details.bond_id : undefined;
			if (message.startsWith('internal code')) {
				return err('conflict', humanize(message), {
					field: 'internalCode',
					conflictingBondId: bondId
				});
			}
			if (message.startsWith('barcode')) {
				return err('conflict', humanize(message), { field: 'barcode', conflictingBondId: bondId });
			}
			return err('conflict', BOND_MESSAGES.duplicate);
		}

		case '55000': {
			const window = /while the campaign is draft or active \(status: (\w+)\)/.exec(message);
			if (window) {
				const label = campaignStatusLabel(window[1]);
				return err('conflict', `${BOND_MESSAGES.campaignLocked} La campaña está ${label}.`);
			}
			if (message.startsWith('a manually grouped pata cannot be annulled directly')) {
				return err('conflict', BOND_MESSAGES.manualPataAnnul);
			}
			const grouped = /belongs to (a )?manually grouped pata/.test(message);
			return err(
				'conflict',
				grouped ? `${humanize(message)} Desagrupar la pata primero.` : humanize(message),
				{ field: fieldFor(message, numberField) }
			);
		}

		case '23514':
		case '23503':
		case '23502':
		case '22P02':
		case '22003':
			return err('validation', BOND_MESSAGES.invalid);

		default:
			return err('internal', BOND_MESSAGES.internal);
	}
}

export interface BondRequestContext {
	requestId?: string | null;
	/**
	 * The request's permission list (`locals.permissions`): enables the up-front check. `null`
	 * (the list failed to load) fails as `internal` (500), not `permission` (403).
	 */
	permissions?: readonly string[] | null;
}

async function callBondRpc(
	supabase: SupabaseClient,
	fn: string,
	permission: PermissionCode,
	args: Record<string, unknown>,
	ctx: BondRequestContext,
	options: { numberField?: BondNumberField } = {}
): Promise<unknown> {
	if (ctx.permissions === null) {
		// The request's permission list failed to load (logged by the hook): an outage, not a denial.
		throw new BondServiceError('internal', BOND_MESSAGES.internal);
	}
	if (ctx.permissions !== undefined && !hasPermissionIn(ctx.permissions, permission)) {
		throw new BondServiceError('permission', BOND_MESSAGES.permission);
	}

	let result: { data: unknown; error: PostgrestLikeError | null };
	try {
		result = await supabase.rpc(fn, args);
	} catch (cause) {
		console.error(`[bonds] ${fn} RPC threw`, { requestId: ctx.requestId, error: cause });
		throw new BondServiceError('internal', BOND_MESSAGES.internal, { cause });
	}

	if (result.error) {
		const mapped = mapBondRpcError(result.error, options);
		if (mapped.kind === 'internal') {
			console.error(`[bonds] ${fn} RPC failed`, { requestId: ctx.requestId, error: result.error });
		}
		throw mapped;
	}
	return result.data;
}

function requireId(fn: string, data: unknown, ctx: BondRequestContext): string {
	if (typeof data !== 'string' || data.length === 0) {
		console.error(`[bonds] ${fn} returned no id`, { requestId: ctx.requestId, data });
		throw new BondServiceError('internal', BOND_MESSAGES.internal);
	}
	return data;
}

/**
 * Creates a simple bond (one base number) or a printed pata (N >= 2) in `available`
 * (`bond.create`). Associated numbers and the total value are computed by the database from the
 * campaign rules. Returns the new bond id. A duplicate number throws a `conflict` (409) whose
 * `conflicts` name every number and the bond that uses it.
 */
export async function createBond(
	supabase: SupabaseClient,
	input: BondCreateInput,
	ctx: BondRequestContext = {}
): Promise<string> {
	const data = await callBondRpc(
		supabase,
		'bond_create',
		'bond.create',
		{
			p_campaign_id: input.campaignId,
			p_base_numbers: input.baseNumbers,
			p_internal_code: input.internalCode,
			p_barcode: input.barcode,
			p_request_id: ctx.requestId ?? null,
			p_reason: input.reason
		},
		ctx,
		{ numberField: input.baseNumbers.length === 1 ? 'baseNumber' : 'baseNumbers' }
	);
	return requireId('bond_create', data, ctx);
}

/**
 * Groups N >= 2 available simple bonds into a manual pata (`bond.create`). Members keep their
 * numbers and status but are blocked from individual operations while grouped. Returns the new
 * pata id.
 */
export async function groupBondsIntoPata(
	supabase: SupabaseClient,
	input: BondGroupInput,
	ctx: BondRequestContext = {}
): Promise<string> {
	const data = await callBondRpc(
		supabase,
		'bond_group_into_pata',
		'bond.create',
		{
			p_campaign_id: input.campaignId,
			p_member_bond_ids: input.memberBondIds,
			p_internal_code: input.internalCode,
			p_barcode: input.barcode,
			p_request_id: ctx.requestId ?? null,
			p_reason: input.reason
		},
		ctx
	);
	return requireId('bond_group_into_pata', data, ctx);
}

/**
 * Ungroups an available manual pata (`bond.create`, reason required): the memberships are kept as
 * history, the pata is annulled and its members are free again.
 */
export async function ungroupPata(
	supabase: SupabaseClient,
	input: BondUngroupInput,
	ctx: BondRequestContext = {}
): Promise<void> {
	await callBondRpc(
		supabase,
		'bond_ungroup_pata',
		'bond.create',
		{
			p_pata_bond_id: input.pataBondId,
			p_reason: input.reason,
			p_request_id: ctx.requestId ?? null
		},
		ctx
	);
}

/**
 * Annuls an available simple bond or printed pata loaded by mistake (`bond.annul`, reason
 * required) and releases its numbers so they can be entered again.
 */
export async function annulBond(
	supabase: SupabaseClient,
	input: BondAnnulInput,
	ctx: BondRequestContext = {}
): Promise<void> {
	await callBondRpc(
		supabase,
		'bond_annul',
		'bond.annul',
		{ p_bond_id: input.bondId, p_reason: input.reason, p_request_id: ctx.requestId ?? null },
		ctx
	);
}

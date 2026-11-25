/**
 * Bond rules (pure domain logic, no framework or database imports).
 *
 * A bond is a sellable commercial unit (docs/data-model.md "bonds"):
 * - a **simple bond** has one base number and its associated number (`base + offset`);
 * - a **printed pata** has N >= 2 base numbers and owns them all plus their associated numbers;
 * - a **manually grouped pata** joins N >= 2 available simple bonds; it owns no numbers (its
 *   members keep theirs and their own commercial status, but cannot be operated individually
 *   while grouped).
 *
 * `commercial_unit_count = N` and `total_value = simple_bond_value * N`, computed in exact cents.
 *
 * Participating numbers (base and associated) are unique per campaign among live bonds: a number
 * can never appear twice in the same bond, nor in two bonds of the same campaign. A bond annulled
 * by mistake releases its numbers so they can be entered again.
 *
 * The database (`bond_create`, `bond_group_into_pata`, migration `20261120000000_bond_rpcs.sql`)
 * enforces the same rules and is the authority; these functions let the app validate and preview
 * before calling it, with the same messages and numbers padded to the campaign's digit count.
 */
import { DomainError } from './errors';
import { centsToDecimalString, MAX_MONEY_CENTS, parseMoneyToCents } from './money';
import {
	assertValidNumberingConfig,
	associatedNumberFor,
	formatCampaignNumber,
	getMaxValidBaseNumber,
	type CampaignNumberingConfig
} from './numbering';

export const BOND_KINDS = ['simple', 'pata'] as const;
export type BondKind = (typeof BOND_KINDS)[number];

export const BOND_ORIGINS = ['printed', 'manual_grouping'] as const;
export type BondOrigin = (typeof BOND_ORIGINS)[number];

export const BOND_COMMERCIAL_STATUSES = [
	'created',
	'available',
	'delivered_to_collector',
	'sold',
	'returned',
	'lost',
	'annulled',
	'closed'
] as const;
export type BondCommercialStatus = (typeof BOND_COMMERCIAL_STATUSES)[number];

export const BOND_COMMERCIAL_STATUS_LABELS: Record<BondCommercialStatus, string> = {
	created: 'Creado',
	available: 'Disponible',
	delivered_to_collector: 'Entregado al cobrador',
	sold: 'Vendido',
	returned: 'Devuelto',
	lost: 'Extraviado',
	annulled: 'Anulado',
	closed: 'Cerrado'
};

export const BOND_FINANCIAL_STATUSES = [
	'no_payments',
	'partial_payments',
	'up_to_date',
	'overdue',
	'fully_paid',
	'uncollectible',
	'annulled'
] as const;
export type BondFinancialStatus = (typeof BOND_FINANCIAL_STATUSES)[number];

export const BOND_FINANCIAL_STATUS_LABELS: Record<BondFinancialStatus, string> = {
	no_payments: 'Sin pagos',
	partial_payments: 'Pagos parciales',
	up_to_date: 'Al día',
	overdue: 'En mora',
	fully_paid: 'Pagado',
	uncollectible: 'Incobrable',
	annulled: 'Anulado'
};

export const BOND_KIND_LABELS: Record<BondKind, string> = {
	simple: 'Bono simple',
	pata: 'Pata'
};

export const BOND_NUMBER_KINDS = ['base', 'associated', 'extraordinary'] as const;
export type BondNumberKind = (typeof BOND_NUMBER_KINDS)[number];

/** Smallest pata (printed or manually grouped): 2 base numbers / 2 simple bonds. */
export const MIN_PATA_SIZE = 2;

export type BondErrorCode =
	| 'no_base_numbers'
	| 'invalid_number'
	| 'out_of_range'
	| 'overflow'
	| 'duplicate_in_bond'
	| 'duplicate_in_campaign'
	| 'invalid_value'
	| 'invalid_config'
	| 'group_too_small'
	| 'group_duplicate_member'
	| 'group_other_campaign'
	| 'group_member_not_simple'
	| 'group_member_not_available'
	| 'group_member_already_grouped';

export interface BondErrorDetails {
	/** The offending number, padded to the campaign's digit count. */
	number?: string;
	/** The bond involved: the one that already uses the number, or the offending member. */
	bondId?: string;
	/** For an already grouped member: the pata it belongs to. */
	pataId?: string;
}

export class BondError extends DomainError<BondErrorCode> {
	readonly details: BondErrorDetails;

	constructor(code: BondErrorCode, message: string, details: BondErrorDetails = {}) {
		super(code, message);
		this.details = details;
	}
}

// ---------------------------------------------------------------------------
// Participating numbers
// ---------------------------------------------------------------------------

/** A base number and its associated number (`base + offset`). */
export interface BaseNumberPair {
	base: number;
	associated: number;
}

export interface ParticipatingNumber {
	value: number;
	kind: 'base' | 'associated';
	/** The base number it comes from (itself for a base number). */
	base: number;
}

function assertConfig(config: CampaignNumberingConfig): void {
	try {
		assertValidNumberingConfig(config);
	} catch (err) {
		throw new BondError('invalid_config', (err as Error).message);
	}
}

/** Padded like the campaign shows it; values outside the format are shown as plain integers. */
function show(value: number, config: CampaignNumberingConfig): string {
	return Number.isSafeInteger(value) && value >= 0
		? String(value).padStart(config.numberDigits, '0')
		: String(value);
}

/**
 * Validates one base number and returns it with its associated number.
 * @throws BondError `invalid_number` (not a non-negative integer), `out_of_range` (above
 *   `maxNumber`), `overflow` (associated number above `maxNumber`, policy `reject`).
 */
function pairFor(base: number, config: CampaignNumberingConfig): BaseNumberPair {
	if (!Number.isSafeInteger(base) || base < 0) {
		throw new BondError(
			'invalid_number',
			`El número base ${String(base)} debe ser un número entero de 0 o más`,
			{ number: String(base) }
		);
	}
	if (base > config.maxNumber) {
		throw new BondError(
			'out_of_range',
			`El número ${show(base, config)} supera el número máximo de la campaña ${show(config.maxNumber, config)}`,
			{ number: show(base, config) }
		);
	}
	const associated = associatedNumberFor(base, config);
	if (associated === null) {
		// Circular mode: bases are 0..B-1 (B = (max + 1) / 2), so the associated numbers fill B..2B-1.
		const highest = getMaxValidBaseNumber(config);
		throw new BondError(
			'overflow',
			`El número base ${show(base, config)} no entra en el modo circular: ` +
				`el número base más alto permitido es ${show(highest, config)}`,
			{ number: show(base, config) }
		);
	}
	if (associated > config.maxNumber) {
		throw new BondError(
			'overflow',
			`El número base ${show(base, config)} desborda: su número asociado ${show(associated, config)} ` +
				`supera el número máximo de la campaña ${show(config.maxNumber, config)} ` +
				`(el número base más alto permitido es ${show(getMaxValidBaseNumber(config), config)})`,
			{ number: show(base, config) }
		);
	}
	return { base, associated };
}

/**
 * The base/associated pairs of N base numbers, in the given order. Validates the range and
 * overflow of each (not repetitions: see {@link findIntraBondCollisions}).
 * @throws BondError `no_base_numbers`, `invalid_number`, `out_of_range`, `overflow`,
 *   `invalid_config`.
 */
export function participatingNumberPairs(
	baseNumbers: readonly number[],
	config: CampaignNumberingConfig
): BaseNumberPair[] {
	assertConfig(config);
	if (baseNumbers.length === 0) {
		throw new BondError('no_base_numbers', 'Se requiere al menos un número base');
	}
	return baseNumbers.map((base) => pairFor(base, config));
}

/** Every participating number of the pairs: each base followed by its associated number. */
export function participatingNumbers(pairs: readonly BaseNumberPair[]): ParticipatingNumber[] {
	return pairs.flatMap(({ base, associated }) => [
		{ value: base, kind: 'base' as const, base },
		{ value: associated, kind: 'associated' as const, base }
	]);
}

export interface IntraBondCollision {
	value: number;
	/** Padded to the campaign's digit count. */
	formatted: string;
	/** How many times it appears as a base number and as an associated number. */
	baseCount: number;
	associatedCount: number;
}

/**
 * Numbers that appear more than once inside the same bond: two equal bases, a base equal to
 * another base's associated number, or (offset 0) a base equal to its own associated number.
 * Sorted by value; empty when the bond is consistent.
 */
export function findIntraBondCollisions(
	pairs: readonly BaseNumberPair[],
	config: CampaignNumberingConfig
): IntraBondCollision[] {
	const counts = new Map<number, { base: number; associated: number }>();
	for (const { value, kind } of participatingNumbers(pairs)) {
		const entry = counts.get(value) ?? { base: 0, associated: 0 };
		entry[kind] += 1;
		counts.set(value, entry);
	}
	return [...counts.entries()]
		.filter(([, c]) => c.base + c.associated > 1)
		.sort(([a], [b]) => a - b)
		.map(([value, c]) => ({
			value,
			formatted: show(value, config),
			baseCount: c.base,
			associatedCount: c.associated
		}));
}

/**
 * Validates the base numbers of a new simple bond / printed pata: at least one, each in range and
 * without overflow, and no participating number repeated inside the bond. Returns the pairs.
 * @throws BondError (`duplicate_in_bond` names the first repeated number).
 */
export function validateBondNumbers(
	baseNumbers: readonly number[],
	config: CampaignNumberingConfig
): BaseNumberPair[] {
	const pairs = participatingNumberPairs(baseNumbers, config);
	const [first] = findIntraBondCollisions(pairs, config);
	if (first) {
		throw new BondError(
			'duplicate_in_bond',
			`El número ${first.formatted} aparece más de una vez en este bono ` +
				`(${first.baseCount} como base, ${first.associatedCount} como asociado)`,
			{ number: first.formatted }
		);
	}
	return pairs;
}

// ---------------------------------------------------------------------------
// Campaign-wide duplicates
// ---------------------------------------------------------------------------

/** A participating number already used (not released) in the campaign. */
export interface ExistingBondNumber {
	numberValue: number;
	bondId: string;
	numberKind: BondNumberKind;
}

export interface CampaignNumberConflict {
	value: number;
	formatted: string;
	/** Role of the number in the NEW bond. */
	kind: 'base' | 'associated';
	/** The bond that already uses it, and the role it has there. */
	bondId: string;
	existingKind: BondNumberKind;
}

/**
 * Participating numbers of the new bond that another bond of the campaign already uses. `existing`
 * must only contain live (not released) numbers of the same campaign. Sorted by value.
 */
export function findCampaignConflicts(
	pairs: readonly BaseNumberPair[],
	existing: readonly ExistingBondNumber[],
	config: CampaignNumberingConfig
): CampaignNumberConflict[] {
	const byValue = new Map(existing.map((n) => [n.numberValue, n]));
	return participatingNumbers(pairs)
		.flatMap(({ value, kind }) => {
			const used = byValue.get(value);
			return used
				? [
						{
							value,
							formatted: show(value, config),
							kind,
							bondId: used.bondId,
							existingKind: used.numberKind
						}
					]
				: [];
		})
		.sort((a, b) => a.value - b.value);
}

/** User-facing message for a campaign-wide duplicate (same wording as the database). */
export function campaignConflictMessage(
	conflict: Pick<CampaignNumberConflict, 'formatted' | 'bondId'>
): string {
	return `El número ${conflict.formatted} ya está en uso en el bono ${conflict.bondId}`;
}

/** @throws BondError `duplicate_in_campaign` naming the first conflicting number and its bond. */
export function assertNoCampaignConflicts(
	pairs: readonly BaseNumberPair[],
	existing: readonly ExistingBondNumber[],
	config: CampaignNumberingConfig
): void {
	const [first] = findCampaignConflicts(pairs, existing, config);
	if (first) {
		throw new BondError('duplicate_in_campaign', campaignConflictMessage(first), {
			number: first.formatted,
			bondId: first.bondId
		});
	}
}

// ---------------------------------------------------------------------------
// Value and composition
// ---------------------------------------------------------------------------

/**
 * `simple_bond_value * units` in exact cents.
 * @throws BondError `invalid_value` for a malformed / non-positive value, a unit count below 1,
 *   or a total that does not fit in `numeric(14,2)`.
 */
export function bondTotalValueCents(simpleBondValue: string, units: number): number {
	const cents = parseMoneyToCents(simpleBondValue);
	if (cents === null || cents <= 0) {
		throw new BondError('invalid_value', `Valor de bono simple no válido: ${simpleBondValue}`);
	}
	if (!Number.isSafeInteger(units) || units < 1) {
		throw new BondError(
			'invalid_value',
			`Cantidad de unidades comerciales no válida: ${String(units)}`
		);
	}
	const total = cents * units;
	if (!Number.isSafeInteger(total) || total > MAX_MONEY_CENTS) {
		throw new BondError('invalid_value', 'El valor total del bono es demasiado grande');
	}
	return total;
}

export interface BondComposition {
	kind: BondKind;
	origin: BondOrigin;
	/** N: base numbers (printed) or member bonds (manual grouping). */
	commercialUnitCount: number;
	/** Canonical two-decimal string: simple_bond_value * N. */
	totalValue: string;
}

export interface PrintedBondComposition extends BondComposition {
	origin: 'printed';
	pairs: BaseNumberPair[];
}

/**
 * Composition of a new simple bond (1 base number) or printed pata (N >= 2): validated pairs,
 * kind, unit count and total value. Does not check campaign-wide duplicates
 * ({@link assertNoCampaignConflicts}).
 */
export function composePrintedBond(
	baseNumbers: readonly number[],
	campaign: CampaignNumberingConfig & { simpleBondValue: string }
): PrintedBondComposition {
	const pairs = validateBondNumbers(baseNumbers, campaign);
	const units = pairs.length;
	return {
		kind: units === 1 ? 'simple' : 'pata',
		origin: 'printed',
		commercialUnitCount: units,
		totalValue: centsToDecimalString(bondTotalValueCents(campaign.simpleBondValue, units)),
		pairs
	};
}

// ---------------------------------------------------------------------------
// Manual grouping
// ---------------------------------------------------------------------------

/** What the grouping rules need to know about each candidate member. */
export interface GroupingCandidate {
	id: string;
	campaignId: string;
	kind: BondKind;
	commercialStatus: BondCommercialStatus;
	/** The manual pata it is an active member of, if any. */
	activeGroupPataId: string | null;
	/** Its base number (simple bonds), used to name it in messages. */
	baseNumber?: number | null;
}

function memberLabel(member: GroupingCandidate, config?: CampaignNumberingConfig): string {
	if (config && member.baseNumber != null) {
		return `${show(member.baseNumber, config)} (${member.id})`;
	}
	return member.id;
}

/**
 * Validates a manual grouping: N >= 2 distinct members, all simple bonds of `campaignId`,
 * `available`, and not active members of another pata. Returns the pata composition
 * (total = simple_bond_value * N). `config` is only used to show members by their number.
 * @throws BondError `group_*` codes, naming the offending bond.
 */
export function validateManualGrouping(
	campaignId: string,
	members: readonly GroupingCandidate[],
	simpleBondValue: string,
	config?: CampaignNumberingConfig
): BondComposition {
	if (members.length < MIN_PATA_SIZE) {
		throw new BondError(
			'group_too_small',
			`Una pata necesita al menos ${MIN_PATA_SIZE} bonos simples`
		);
	}
	const seen = new Set<string>();
	for (const member of members) {
		if (seen.has(member.id)) {
			throw new BondError('group_duplicate_member', `El bono ${member.id} figura más de una vez`, {
				bondId: member.id
			});
		}
		seen.add(member.id);
	}
	for (const member of members) {
		const label = memberLabel(member, config);
		if (member.campaignId !== campaignId) {
			throw new BondError('group_other_campaign', `El bono ${label} pertenece a otra campaña`, {
				bondId: member.id
			});
		}
		if (member.kind !== 'simple') {
			throw new BondError(
				'group_member_not_simple',
				`Solo se pueden agrupar bonos simples en una pata (el bono ${label} es una pata)`,
				{ bondId: member.id }
			);
		}
		if (member.commercialStatus !== 'available') {
			throw new BondError(
				'group_member_not_available',
				`Solo se pueden agrupar bonos disponibles (el bono ${label} está en estado ${BOND_COMMERCIAL_STATUS_LABELS[member.commercialStatus].toLowerCase()})`,
				{ bondId: member.id }
			);
		}
		if (member.activeGroupPataId) {
			throw new BondError(
				'group_member_already_grouped',
				`El bono ${label} ya pertenece a la pata manual ${member.activeGroupPataId}`,
				{ bondId: member.id, pataId: member.activeGroupPataId }
			);
		}
	}
	return {
		kind: 'pata',
		origin: 'manual_grouping',
		commercialUnitCount: members.length,
		totalValue: centsToDecimalString(bondTotalValueCents(simpleBondValue, members.length))
	};
}

/** The visible form of a bond number (re-exported for callers that only import bonds). */
export function formatBondNumber(value: number, config: CampaignNumberingConfig): string {
	return formatCampaignNumber(value, config);
}

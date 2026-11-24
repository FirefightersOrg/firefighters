/**
 * Campaign entity, status machine and edit windows (pure, client-safe).
 *
 * The database is the source of truth (`campaigns_guard_write` trigger and the `campaign_*`
 * SQL functions). These helpers mirror it so the UI only offers actions that can succeed;
 * the server always re-checks.
 */
import type { CampaignNumberingConfig, OverflowPolicy } from './numbering';

export const CAMPAIGN_STATUSES = ['draft', 'active', 'closing', 'closed', 'annulled'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
	draft: 'Borrador',
	active: 'Activa',
	closing: 'En cierre',
	closed: 'Cerrada',
	annulled: 'Anulada'
};

/** How a scanned barcode is interpreted (docs/imports.md). Chosen at creation, no default. */
export const BARCODE_MODES = [
	'base_number',
	'internal_code',
	'external_legacy_code',
	'manual_mapping'
] as const;
export type BarcodeMode = (typeof BARCODE_MODES)[number];

export const BARCODE_MODE_LABELS: Record<BarcodeMode, string> = {
	base_number: 'Barcode is the base number',
	internal_code: 'Internal code',
	external_legacy_code: 'External / legacy code',
	manual_mapping: 'Manual mapping'
};

/**
 * Modes whose barcodes are read with the campaign's `barcodePattern` (a regex whose first capture
 * group is the base number). Without a pattern they behave like `manual_mapping`: the operator
 * types the base number when scanning.
 */
export const BARCODE_PATTERN_MODES = ['internal_code', 'external_legacy_code'] as const;
/** Same limit as the `campaigns_barcode_pattern_format` CHECK. */
export const BARCODE_PATTERN_MAX_LENGTH = 200;

export function barcodeModeUsesPattern(mode: string): boolean {
	return (BARCODE_PATTERN_MODES as readonly string[]).includes(mode);
}

/** Statuses a campaign can be moved to (`draft` is only ever the initial status). */
export const CAMPAIGN_TRANSITION_TARGETS = ['active', 'closing', 'closed', 'annulled'] as const;
export type CampaignTransitionTarget = (typeof CAMPAIGN_TRANSITION_TARGETS)[number];

/** Allowed transitions (docs/state-machines.md). */
export const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, readonly CampaignTransitionTarget[]> = {
	draft: ['active', 'annulled'],
	active: ['closing', 'annulled'],
	closing: ['closed'],
	closed: [],
	annulled: []
};

/**
 * Permission required to move a campaign INTO each status. Activation needs
 * `campaign.update_rules` because it freezes the rules; active → closing, closing → closed and
 * annulling (from draft or active) need
 * `campaign.close`. Mirrors `public.campaign_transition`.
 */
export const CAMPAIGN_TRANSITION_PERMISSIONS: Record<
	CampaignTransitionTarget,
	'campaign.update_rules' | 'campaign.close'
> = {
	active: 'campaign.update_rules',
	closing: 'campaign.close',
	closed: 'campaign.close',
	annulled: 'campaign.close'
};

export function isCampaignTransitionAllowed(
	from: CampaignStatus,
	to: CampaignTransitionTarget
): boolean {
	return CAMPAIGN_TRANSITIONS[from].includes(to);
}

/** Transitions from `status` the holder of `permissions` may perform. */
export function availableCampaignTransitions(
	status: CampaignStatus,
	permissions: readonly string[]
): CampaignTransitionTarget[] {
	return CAMPAIGN_TRANSITIONS[status].filter((to) =>
		permissions.includes(CAMPAIGN_TRANSITION_PERMISSIONS[to])
	);
}

/** Numbering, installment, overflow and barcode rules: draft only. */
export function canEditCampaignRules(status: CampaignStatus): boolean {
	return status === 'draft';
}

/** starts_at / ends_at: draft and active. */
export function canEditCampaignDates(status: CampaignStatus): boolean {
	return status === 'draft' || status === 'active';
}

/** Name: until the campaign is closed or annulled. */
export function canEditCampaignName(status: CampaignStatus): boolean {
	return status === 'draft' || status === 'active' || status === 'closing';
}

/**
 * Bonds can be loaded (and grouped, ungrouped or annulled) while the campaign is a draft or
 * active (`bond_create` and the other `bond_*` SQL functions enforce the same window).
 */
export function canLoadBonds(status: CampaignStatus): boolean {
	return status === 'draft' || status === 'active';
}

/** Deliveries and reassignments are issued only after the campaign is active. */
export function canDeliverBonds(status: CampaignStatus): boolean {
	return status === 'active';
}

/** App representation of a `campaigns` row. Money is a two-decimal string (see `money.ts`). */
export interface Campaign {
	id: string;
	name: string;
	status: CampaignStatus;
	/** ISO timestamps; null until set (both are required to activate). */
	startsAt: string | null;
	endsAt: string | null;
	simpleBondValue: string;
	installmentCount: number;
	/** Derived: simpleBondValue / installmentCount, always exact. */
	installmentValue: string;
	numberDigits: number;
	maxNumber: number;
	associatedNumberOffset: number;
	overflowPolicy: OverflowPolicy;
	barcodeMode: BarcodeMode;
	/** Regex extracting the base number (first capture group); only for BARCODE_PATTERN_MODES. */
	barcodePattern: string | null;
	createdBy: string | null;
	createdAt: string;
	updatedAt: string;
}

export function campaignNumberingConfig(
	campaign: Pick<
		Campaign,
		'numberDigits' | 'maxNumber' | 'associatedNumberOffset' | 'overflowPolicy'
	>
): CampaignNumberingConfig {
	return {
		numberDigits: campaign.numberDigits,
		maxNumber: campaign.maxNumber,
		associatedNumberOffset: campaign.associatedNumberOffset,
		overflowPolicy: campaign.overflowPolicy
	};
}

// ---------------------------------------------------------------------------
// Campaign dates
// ---------------------------------------------------------------------------
// Campaign dates are entered as calendar days and interpreted in the organization's time zone
// (Argentina, UTC-03:00, no daylight saving time since 2009): starts_at is the start of the
// first day and ends_at the last second of the last day, so a one-day campaign is valid.

export const CAMPAIGN_TIME_ZONE = 'America/Argentina/Buenos_Aires';
const CAMPAIGN_UTC_OFFSET = '-03:00';
const CAMPAIGN_UTC_OFFSET_MS = -3 * 60 * 60 * 1000;

/** `"2026-03-01"` → `"2026-03-01T00:00:00-03:00"`. */
export function campaignDayStart(day: string): string {
	return `${day}T00:00:00${CAMPAIGN_UTC_OFFSET}`;
}

/** `"2026-12-31"` → `"2026-12-31T23:59:59-03:00"`. */
export function campaignDayEnd(day: string): string {
	return `${day}T23:59:59${CAMPAIGN_UTC_OFFSET}`;
}

/** ISO timestamp → calendar day (`YYYY-MM-DD`) in the campaign time zone; null passes through. */
export function toCampaignDay(timestamp: string | null): string | null {
	if (!timestamp) return null;
	const ms = Date.parse(timestamp);
	if (Number.isNaN(ms)) return null;
	return new Date(ms + CAMPAIGN_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Returns `current` when `next` falls on the same campaign day, otherwise `next`. The edit form
 * works with calendar days, so re-saving an unchanged day must not rewrite a stored timestamp
 * whose time is not exactly the start/end of the day (e.g. set outside the UI).
 */
export function keepTimestampIfSameDay(next: string | null, current: string | null): string | null {
	if (next && current && toCampaignDay(next) === toCampaignDay(current)) return current;
	return next;
}

/** Display format for a campaign date (`"Mar 1, 2026"`), or an em dash when unset. */
export function formatCampaignDate(timestamp: string | null): string {
	if (!timestamp) return '—';
	const ms = Date.parse(timestamp);
	if (Number.isNaN(ms)) return '—';
	return new Intl.DateTimeFormat('en-US', {
		dateStyle: 'medium',
		timeZone: CAMPAIGN_TIME_ZONE
	}).format(ms);
}

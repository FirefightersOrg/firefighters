/**
 * Collectors and buyers (SAN-49). Global across campaigns; never deleted (collectors are
 * deactivated). See docs/data-model.md and the migration `20261203000000_collectors_buyers.sql`.
 */

export const COLLECTOR_STATUSES = ['active', 'inactive'] as const;
export type CollectorStatus = (typeof COLLECTOR_STATUSES)[number];

export const COLLECTOR_STATUS_LABELS: Record<CollectorStatus, string> = {
	active: 'Active',
	inactive: 'Inactive'
};

export const BUYER_TYPES = ['individual', 'business'] as const;
export type BuyerType = (typeof BUYER_TYPES)[number];

export const BUYER_TYPE_LABELS: Record<BuyerType, string> = {
	individual: 'Individual',
	business: 'Business'
};

/** Field limits, the same as the database CHECK constraints. */
export const PARTY_LIMITS = {
	displayName: 200,
	firstName: 100,
	lastName: 100,
	businessName: 200,
	documentNumber: 30,
	taxId: 30,
	phone: 50,
	email: 254,
	address: 500,
	notes: 2000
} as const;

export interface Collector {
	id: string;
	displayName: string;
	phone: string | null;
	email: string | null;
	address: string | null;
	userProfileId: string | null;
	status: CollectorStatus;
	createdBy: string | null;
	createdAt: string;
	/** Version for optimistic concurrency (`collector_update`). */
	updatedAt: string;
}

export interface Buyer {
	id: string;
	type: BuyerType;
	firstName: string | null;
	lastName: string | null;
	businessName: string | null;
	documentNumber: string | null;
	taxId: string | null;
	phone: string | null;
	address: string | null;
	usualCollectorId: string | null;
	notes: string | null;
	createdBy: string | null;
	createdAt: string;
	/** Version for optimistic concurrency (`buyer_update`). */
	updatedAt: string;
}

/** How a buyer is named on screens: the business name, or "Last, First". */
export function buyerDisplayName(
	buyer: Pick<Buyer, 'type' | 'firstName' | 'lastName' | 'businessName'>
): string {
	if (buyer.type === 'business') return buyer.businessName ?? '—';
	if (buyer.lastName && buyer.firstName) return `${buyer.lastName}, ${buyer.firstName}`;
	return buyer.lastName ?? buyer.firstName ?? '—';
}

/** The identification shown next to a buyer: tax id for businesses, document otherwise. */
export function buyerIdentification(
	buyer: Pick<Buyer, 'type' | 'documentNumber' | 'taxId'>
): string | null {
	return buyer.type === 'business'
		? (buyer.taxId ?? buyer.documentNumber)
		: (buyer.documentNumber ?? buyer.taxId);
}

/**
 * A search term made safe for a PostgREST `or=(…ilike…)` filter: trimmed, at most 100
 * characters, without the characters that break the filter syntax or act as wildcards.
 * Returns null when nothing searchable is left.
 */
export function partySearchTerm(value: string | null | undefined): string | null {
	const cleaned = (value ?? '')
		.replace(/[,()*%_\\:"']/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 100);
	return cleaned === '' ? null : cleaned;
}

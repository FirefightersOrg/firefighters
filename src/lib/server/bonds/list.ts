import { z } from 'zod';
import {
	BOND_COMMERCIAL_STATUSES,
	BOND_FINANCIAL_STATUSES,
	BOND_KINDS,
	type BondCommercialStatus,
	type BondFinancialStatus,
	type BondKind,
	type BondOrigin
} from '$lib/domain/bonds';
import { campaignNumberingConfig, type Campaign } from '$lib/domain/campaigns';
import { formatCampaignNumber, parseCampaignNumber } from '$lib/domain/numbering';
import type { BondListEntry, BondListFilters } from '$lib/server/repositories/bonds';
import { bondTypeLabel, formatPataLabel } from './record';

/**
 * Bonds list (`/campaigns/[id]/bonds`): query-string filters (so the list works without
 * JavaScript and can be bookmarked) and the row view model.
 */

/** Query parameters of the list, in form order. */
export const BOND_LIST_QUERY_FIELDS = [
	'base',
	'associated',
	'code',
	'type',
	'status',
	'financial',
	'collector'
] as const;
export type BondListQueryField = (typeof BOND_LIST_QUERY_FIELDS)[number];

/** Longest barcode / internal code searched (longer input is rejected). */
export const MAX_CODE_SEARCH_LENGTH = 100;

export interface BondListQuery {
	/** The submitted values (trimmed), to refill the form and build page links. */
	values: Record<BondListQueryField, string>;
	filters: BondListFilters;
	/** Field messages for values that cannot be used; the list is not queried while any exists. */
	errors: Partial<Record<BondListQueryField, string>>;
	/** Requested page (1 when missing or invalid). */
	page: number;
}

function oneOfOrNull<T extends string>(allowed: readonly T[], value: string): T | null {
	return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

export function parseBondListQuery(params: URLSearchParams, campaign: Campaign): BondListQuery {
	const config = campaignNumberingConfig(campaign);
	const values = Object.fromEntries(
		BOND_LIST_QUERY_FIELDS.map((field) => [field, (params.get(field) ?? '').trim()])
	) as Record<BondListQueryField, string>;
	const errors: BondListQuery['errors'] = {};

	const number = (field: 'base' | 'associated'): number | null => {
		if (!values[field]) return null;
		try {
			return parseCampaignNumber(values[field], config);
		} catch {
			errors[field] =
				`Ingresar un número entre ${formatCampaignNumber(0, config)} y ` +
				`${formatCampaignNumber(config.maxNumber, config)}.`;
			return null;
		}
	};
	const choice = <T extends string>(field: BondListQueryField, allowed: readonly T[]) => {
		if (!values[field]) return null;
		const parsed = oneOfOrNull(allowed, values[field]);
		if (!parsed) errors[field] = 'Elegir una de las opciones de la lista.';
		return parsed;
	};

	const filters: BondListFilters = {
		baseNumber: number('base'),
		associatedNumber: number('associated'),
		code: values.code || null,
		kind: choice<BondKind>('type', BOND_KINDS),
		commercialStatus: choice<BondCommercialStatus>('status', BOND_COMMERCIAL_STATUSES),
		financialStatus: choice<BondFinancialStatus>('financial', BOND_FINANCIAL_STATUSES),
		// A collector id from a link (the collector record). Anything that is not an id is refused
		// here, so it never reaches the database; an unknown id simply matches no bond.
		collectorId: null
	};
	if (values.collector) {
		if (z.guid().safeParse(values.collector).success) filters.collectorId = values.collector;
		else errors.collector = 'El cobrador indicado no es válido.';
	}
	if (values.code.length > MAX_CODE_SEARCH_LENGTH) {
		errors.code = `Ingresar hasta ${MAX_CODE_SEARCH_LENGTH} caracteres.`;
	}

	const rawPage = params.get('page') ?? '';
	const page = /^\d{1,6}$/.test(rawPage) && Number(rawPage) >= 1 ? Number(rawPage) : 1;
	return { values, filters, errors, page };
}

/** A row of the bonds list, ready to show. */
export interface BondListItem {
	id: string;
	kind: BondKind;
	origin: BondOrigin;
	typeLabel: string;
	/** Padded base numbers (a manual pata: its members'). */
	baseFormatted: string[];
	associatedFormatted: string[];
	internalCode: string | null;
	barcode: string | null;
	commercialStatus: BondCommercialStatus;
	financialStatus: BondFinancialStatus;
	unitCount: number;
	/** Two-decimal string. */
	totalValue: string;
	/** For an active member of a manual pata: that pata ("in pata 0068 + 0069"). */
	inPata: { pataId: string; label: string } | null;
}

export function buildBondListItems(
	entries: readonly BondListEntry[],
	pataBaseNumbers: ReadonlyMap<string, readonly number[]>,
	campaign: Campaign
): BondListItem[] {
	const config = campaignNumberingConfig(campaign);
	const format = (n: number) => formatCampaignNumber(n, config);
	return entries.map((entry) => ({
		id: entry.id,
		kind: entry.kind,
		origin: entry.origin,
		typeLabel: bondTypeLabel(entry),
		baseFormatted: entry.baseNumbers.map(format),
		associatedFormatted: entry.associatedNumbers.map(format),
		internalCode: entry.internalCode,
		barcode: entry.barcode,
		commercialStatus: entry.commercialStatus,
		financialStatus: entry.financialStatus,
		unitCount: entry.commercialUnitCount,
		totalValue: entry.totalValue,
		inPata: entry.groupPataId
			? {
					pataId: entry.groupPataId,
					label: formatPataLabel(pataBaseNumbers.get(entry.groupPataId) ?? [], campaign)
				}
			: null
	}));
}

/**
 * Live preview of a printed pata typed in the pata entry form (pure): every typed base number
 * with its associated number (or why it cannot be used), the numbers repeated inside the pata,
 * N (`commercial_unit_count`) and the total value (`simple_bond_value * N`).
 *
 * Built on the same helpers as the bond schema (`previewBaseNumber`, `findIntraBondCollisions`,
 * `bondTotalValueCents`), so what the preview says is what the server answers. Duplicates against
 * other bonds of the campaign are only known to the database: they are reported after saving.
 */
import { previewBaseNumber, type BaseNumberPreview } from './bond-preview';
import {
	BondError,
	bondTotalValueCents,
	findIntraBondCollisions,
	MIN_PATA_SIZE,
	type IntraBondCollision
} from './bonds';
import { centsToDecimalString } from './money';
import type { CampaignNumberingConfig } from './numbering';

/** Separators accepted between base numbers (same as the pata schema). */
export const PATA_NUMBER_SEPARATORS = /[\s,;]+/;

/** The typed base numbers, without blanks (`"68, 69;70"` → `["68", "69", "70"]`). */
export function splitBaseNumbers(input: string): string[] {
	return input
		.split(PATA_NUMBER_SEPARATORS)
		.map((entry) => entry.trim())
		.filter((entry) => entry !== '');
}

export interface PataPreviewEntry {
	/** As typed. */
	typed: string;
	preview: Exclude<BaseNumberPreview, { state: 'empty' }>;
}

export interface PataPreview {
	entries: PataPreviewEntry[];
	/** Numbers that appear more than once in the pata (only among valid entries). */
	collisions: IntraBondCollision[];
	/** N: base numbers typed. */
	unitCount: number;
	/** `simple_bond_value * N` as a two-decimal string; null when N is 0 or the value is invalid. */
	totalValue: string | null;
	/** Problems that block saving, in display order (empty when the pata can be saved). */
	problems: string[];
	ok: boolean;
}

/**
 * Example (4 digits / max 9999 / offset 4871, value 60000.00): `"68 69"` → entries
 * `0068 → 4939`, `0069 → 4940`; N = 2; total `120000.00`; ok.
 */
export function previewPata(
	input: string,
	config: CampaignNumberingConfig,
	simpleBondValue: string
): PataPreview {
	const entries: PataPreviewEntry[] = splitBaseNumbers(input).map((typed) => ({
		typed,
		preview: previewBaseNumber(typed, config) as PataPreviewEntry['preview']
	}));
	const pairs = entries.flatMap(({ preview }) =>
		preview.state === 'ok' ? [{ base: preview.base, associated: preview.associated }] : []
	);
	const collisions = findIntraBondCollisions(pairs, config);
	const unitCount = entries.length;

	let totalValue: string | null = null;
	if (unitCount > 0) {
		try {
			totalValue = centsToDecimalString(bondTotalValueCents(simpleBondValue, unitCount));
		} catch (err) {
			if (!(err instanceof BondError)) throw err;
		}
	}

	const problems: string[] = [];
	if (unitCount < MIN_PATA_SIZE) {
		problems.push(`A pata needs at least ${MIN_PATA_SIZE} base numbers`);
	}
	for (const { preview } of entries) {
		if (preview.state === 'invalid') problems.push(preview.message);
	}
	for (const collision of collisions) {
		problems.push(
			`Number ${collision.formatted} appears more than once in this pata ` +
				`(${collision.baseCount} as base, ${collision.associatedCount} as associated)`
		);
	}

	return { entries, collisions, unitCount, totalValue, problems, ok: problems.length === 0 };
}

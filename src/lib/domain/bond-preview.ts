/**
 * Live preview of a base number typed in the bond entry form (pure): the base number padded like
 * the campaign shows it and its associated number, or why the number cannot be used.
 *
 * Built on the same helpers as the bond schema (`parseCampaignNumber`, `validateBondNumbers`,
 * `calculateAssociatedNumber`, `formatCampaignNumber`) and with the same messages, so what the
 * preview says is what the server answers. Duplicates against other bonds are only known to the
 * database: they are reported after saving.
 */
import { BondError, validateBondNumbers } from './bonds';
import {
	calculateAssociatedNumber,
	formatCampaignNumber,
	NumberingError,
	parseCampaignNumber,
	type CampaignNumberingConfig
} from './numbering';
import type { NumberPair } from './numbering-preview';

/** `repeated`: the number would appear twice in the bond (only possible with offset 0). */
export type BaseNumberProblem = 'invalid_format' | 'out_of_range' | 'overflow' | 'repeated';

export type BaseNumberPreview =
	| { state: 'empty' }
	| { state: 'invalid'; problem: BaseNumberProblem; message: string }
	| ({ state: 'ok' } & NumberPair);

/**
 * Example (4 digits / max 9999 / offset 4871): `"68"` and `"0068"` → `0068 → 4939`;
 * `"5129"` → overflow (its associated number 10000 exceeds 9999); `"12345"` → invalid format.
 * With 5 digits / max 99999 / offset 48710: `"68"` → `00068 → 48778`.
 */
export function previewBaseNumber(
	input: string,
	config: CampaignNumberingConfig
): BaseNumberPreview {
	const typed = input.trim();
	if (typed === '') return { state: 'empty' };

	let base: number;
	try {
		base = parseCampaignNumber(typed, config);
	} catch (err) {
		if (!(err instanceof NumberingError)) throw err;
		return err.code === 'out_of_range'
			? {
					state: 'invalid',
					problem: 'out_of_range',
					message: `El número ${typed} supera el número máximo de la campaña ${formatCampaignNumber(config.maxNumber, config)}`
				}
			: {
					state: 'invalid',
					problem: 'invalid_format',
					message: `«${typed}» no es un número válido (usar hasta ${config.numberDigits} dígitos)`
				};
	}

	try {
		validateBondNumbers([base], config);
	} catch (err) {
		if (!(err instanceof BondError)) throw err;
		return {
			state: 'invalid',
			problem:
				err.code === 'overflow'
					? 'overflow'
					: err.code === 'duplicate_in_bond'
						? 'repeated'
						: 'out_of_range',
			message: err.message
		};
	}

	const associated = calculateAssociatedNumber(base, config);
	return {
		state: 'ok',
		base,
		baseFormatted: formatCampaignNumber(base, config),
		associated,
		associatedFormatted: formatCampaignNumber(associated, config)
	};
}

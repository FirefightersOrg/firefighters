import { describe, expect, it } from 'vitest';
import type { Campaign } from '$lib/domain/campaigns';
import {
	campaignEditFormKey,
	campaignEditSnapshot,
	generalValuesOf,
	rulesValuesOf,
	withSubmitted
} from './types';

const V1 = '2026-11-17T10:00:00.123456+00:00';
const V2 = '2026-11-17T10:05:00.654321+00:00';

function campaign(overrides: Partial<Campaign> = {}): Campaign {
	return {
		id: 'f0000000-0000-0000-0000-000000000001',
		name: 'Campaign 2026',
		status: 'draft',
		startsAt: null,
		endsAt: null,
		simpleBondValue: '60000.00',
		installmentCount: 10,
		installmentValue: '6000.00',
		numberDigits: 4,
		maxNumber: 9999,
		associatedNumberOffset: 4871,
		overflowPolicy: 'reject',
		barcodeMode: 'base_number',
		createdBy: null,
		createdAt: V1,
		updatedAt: V1,
		...overrides
	};
}

describe('withSubmitted', () => {
	it('overlays only the known string fields', () => {
		expect(withSubmitted({ a: '1', b: '2' }, { a: 'x', c: 'y' })).toEqual({ a: 'x', b: '2' });
		expect(withSubmitted({ a: '1' })).toEqual({ a: '1' });
	});
});

describe('campaignEditFormKey', () => {
	it('changes with the campaign and with its version, not otherwise', () => {
		const loaded = campaign();
		expect(campaignEditFormKey(loaded)).toBe(campaignEditFormKey(campaign()));
		expect(campaignEditFormKey(campaign({ updatedAt: V2 }))).not.toBe(campaignEditFormKey(loaded));
		expect(campaignEditFormKey(campaign({ id: 'f0000000-0000-0000-0000-000000000002' }))).not.toBe(
			campaignEditFormKey(loaded)
		);
	});
});

describe('campaignEditSnapshot', () => {
	it('takes values and version from the loaded campaign', () => {
		const loaded = campaign();
		expect(campaignEditSnapshot(generalValuesOf(loaded), loaded)).toEqual({
			values: { name: 'Campaign 2026', startsOn: '', endsOn: '' },
			version: V1
		});
	});

	it('shows the values of a failed submit again when they are based on the loaded version', () => {
		const loaded = campaign();
		const submitted = { name: '', startsOn: '', endsOn: '', expectedUpdatedAt: V1 };
		expect(campaignEditSnapshot(generalValuesOf(loaded), loaded, submitted)).toEqual({
			values: { name: '', startsOn: '', endsOn: '' },
			version: V1
		});
	});

	it('drops submitted values based on an older version instead of pairing them with the new one', () => {
		const reloaded = campaign({ name: 'Renamed elsewhere', updatedAt: V2 });
		const submitted = { name: 'Old name', startsOn: '', endsOn: '', expectedUpdatedAt: V1 };
		expect(campaignEditSnapshot(generalValuesOf(reloaded), reloaded, submitted)).toEqual({
			values: { name: 'Renamed elsewhere', startsOn: '', endsOn: '' },
			version: V2
		});
	});

	// Reviewer scenario: the page shows the campaign at V1, another session renames it and changes
	// its rules, then a status change here succeeds and the page reloads it at V2. Before the fix
	// the forms kept the V1 inputs but posted the V2 version, so a later save passed the version
	// check and silently overwrote the newer data.
	it('after a reload with a new version, the forms re-mount with that load’s values and version', () => {
		const before = campaign();
		const after = campaign({
			name: 'Renamed elsewhere',
			simpleBondValue: '80000.00',
			installmentValue: '8000.00',
			status: 'active',
			updatedAt: V2
		});

		// The `{#key}` around the forms changes, so they re-mount (the transition result is not
		// theirs, so they get no submitted values)...
		expect(campaignEditFormKey(after)).not.toBe(campaignEditFormKey(before));
		const general = campaignEditSnapshot(generalValuesOf(after), after, undefined);
		const rules = campaignEditSnapshot(rulesValuesOf(after), after, undefined);

		// ...and never post a V1 value under the V2 version.
		expect(general).toEqual({ values: generalValuesOf(after), version: V2 });
		expect(general.values.name).toBe('Renamed elsewhere');
		expect(rules).toEqual({ values: rulesValuesOf(after), version: V2 });
		expect(rules.values.simpleBondValue).not.toBe(rulesValuesOf(before).simpleBondValue);
	});
});

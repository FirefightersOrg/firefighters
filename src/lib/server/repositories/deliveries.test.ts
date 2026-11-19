import { describe, expect, it } from 'vitest';
import { deliveryDateBounds } from './deliveries';

describe('deliveryDateBounds', () => {
	it('uses half-open Argentina calendar-day bounds', () => {
		expect(deliveryDateBounds({ from: '2026-11-18', to: '2026-11-18' })).toEqual({
			from: '2026-11-18T00:00:00-03:00',
			to: '2026-11-19T00:00:00-03:00'
		});
	});
});

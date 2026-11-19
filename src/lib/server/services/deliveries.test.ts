import { describe, expect, it } from 'vitest';
import { DELIVERY_MESSAGES, mapDeliveryRpcError } from './deliveries';

describe('mapDeliveryRpcError', () => {
	it.each([
		[
			{ code: '42501', message: 'permission denied: bond.return is required' },
			'permission',
			403,
			DELIVERY_MESSAGES.permission,
			undefined
		],
		[
			{ code: '22023', message: 'the responsible party is required' },
			'validation',
			400,
			'The responsible party is required.',
			'responsibleParty'
		],
		[
			{ code: '22023', message: 'the date of the loss cannot be in the future' },
			'validation',
			400,
			'The date of the loss cannot be in the future.',
			'lostOn'
		],
		[
			{ code: '22023', message: 'a bond belongs to another campaign' },
			'validation',
			400,
			'A bond belongs to another campaign.',
			'bondIds'
		],
		[
			{ code: 'P0002', message: 'collector 0b9a7c1e-1111-4222-8333-444455556666 not found' },
			'not_found',
			404,
			DELIVERY_MESSAGES.collectorNotFound,
			'collectorId'
		],
		[
			{ code: 'P0002', message: 'bond not found' },
			'not_found',
			404,
			DELIVERY_MESSAGES.bondNotFound,
			'bondIds'
		],
		[
			{
				code: '55000',
				message: 'bond 0068 is sold and cannot be returned (only bonds delivered to a collector)'
			},
			'conflict',
			409,
			'Bond 0068 is sold and cannot be returned (only bonds delivered to a collector).',
			'bondIds'
		],
		[
			{ code: '55000', message: 'collector Old is inactive and cannot receive bonds' },
			'conflict',
			409,
			'Collector Old is inactive and cannot receive bonds.',
			'collectorId'
		],
		[
			{
				code: '55000',
				message: 'bonds can only be changed while the campaign is draft or active (status: closed)'
			},
			'conflict',
			409,
			`${DELIVERY_MESSAGES.campaignLocked} This campaign is closed.`,
			undefined
		],
		[{ code: 'XX000', message: 'boom' }, 'internal', 500, DELIVERY_MESSAGES.internal, undefined]
	])('%o', (error, kind, status, message, field) => {
		const mapped = mapDeliveryRpcError(error);
		expect(mapped).toMatchObject({ kind, message, field });
		expect(mapped.status).toBe(status);
	});
});

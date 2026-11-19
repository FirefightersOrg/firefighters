import { describe, expect, it } from 'vitest';
import { PARTY_MESSAGES, mapPartyRpcError } from './parties';

const ID = '0b9a7c1e-1111-4222-8333-444455556666';

describe('mapPartyRpcError', () => {
	it.each([
		[
			{ code: '42501', message: 'permission denied: buyer.manage is required' },
			'permission',
			403,
			PARTY_MESSAGES.permission,
			undefined
		],
		[
			{ code: '22023', message: 'a display name is required' },
			'validation',
			400,
			'A display name is required.',
			'displayName'
		],
		[
			{ code: '22023', message: 'email is not valid' },
			'validation',
			400,
			'Email is not valid.',
			'email'
		],
		[
			{ code: '22023', message: 'an individual buyer needs a first or last name' },
			'validation',
			400,
			'An individual buyer needs a first or last name.',
			'firstName'
		],
		[
			{ code: '22023', message: 'a business buyer needs a business name' },
			'validation',
			400,
			'A business buyer needs a business name.',
			'businessName'
		],
		[
			{ code: '22023', message: 'tax id must be at most 30 characters' },
			'validation',
			400,
			'Tax id must be at most 30 characters.',
			'taxId'
		],
		[
			{ code: '22023', message: `profile ${ID} not found` },
			'validation',
			400,
			'That user does not exist.',
			'userProfileId'
		],
		[
			{ code: 'P0002', message: `usual collector ${ID} not found` },
			'not_found',
			404,
			PARTY_MESSAGES.usualCollectorNotFound,
			'usualCollectorId'
		],
		[
			{ code: 'P0002', message: `buyer ${ID} not found` },
			'not_found',
			404,
			PARTY_MESSAGES.buyerNotFound,
			undefined
		],
		[
			{ code: 'P0002', message: `collector ${ID} not found` },
			'not_found',
			404,
			PARTY_MESSAGES.collectorNotFound,
			undefined
		],
		[
			{
				code: '23505',
				message: 'duplicate key value violates unique constraint "collectors_user_profile_key"'
			},
			'conflict',
			409,
			PARTY_MESSAGES.profileLinked,
			'userProfileId'
		],
		[
			{ code: 'PT409', message: 'buyer was modified by someone else' },
			'conflict',
			409,
			PARTY_MESSAGES.stale,
			undefined
		],
		[{ code: 'XX000', message: 'boom' }, 'internal', 500, PARTY_MESSAGES.internal, undefined]
	])('%o', (error, kind, status, message, field) => {
		const mapped = mapPartyRpcError(error);
		expect(mapped).toMatchObject({ kind, message, field });
		expect(mapped.status).toBe(status);
	});
});

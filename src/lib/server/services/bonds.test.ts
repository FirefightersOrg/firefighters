import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	annulBond,
	BOND_MESSAGES,
	BondServiceError,
	createBond,
	groupBondsIntoPata,
	mapBondRpcError,
	ungroupPata
} from './bonds';
import {
	bondAnnulSchema,
	bondCreatePataSchema,
	bondCreateSimpleSchema,
	bondGroupSchema,
	bondUngroupSchema
} from '$lib/schemas/bond';
import { DEFAULT_NUMBERING_CONFIG } from '$lib/domain/numbering';

const CAMPAIGN_ID = 'f0000000-0000-0000-0000-000000000001';
const BOND_A = 'e0000000-0000-0000-0000-00000000000a';
const BOND_B = 'e0000000-0000-0000-0000-00000000000b';
const NEW_ID = 'd0000000-0000-0000-0000-000000000001';

function rpcClient(result: { data?: unknown; error?: unknown } | Error) {
	const rpc = vi
		.fn()
		.mockImplementation(() =>
			result instanceof Error
				? Promise.reject(result)
				: Promise.resolve({ data: result.data ?? null, error: result.error ?? null })
		);
	return { supabase: { rpc } as unknown as SupabaseClient, rpc };
}

const empty = { internalCode: '', barcode: '', reason: '' };
const simpleInput = bondCreateSimpleSchema(DEFAULT_NUMBERING_CONFIG).parse({
	...empty,
	campaignId: CAMPAIGN_ID,
	baseNumber: '0068',
	internalCode: 'INT-1'
});
const pataInput = bondCreatePataSchema(DEFAULT_NUMBERING_CONFIG).parse({
	...empty,
	campaignId: CAMPAIGN_ID,
	baseNumbers: '0100 0200'
});
const groupInput = bondGroupSchema.parse({
	...empty,
	campaignId: CAMPAIGN_ID,
	memberBondIds: [BOND_A, BOND_B],
	reason: 'Together'
});
const ungroupInput = bondUngroupSchema.parse({ pataBondId: BOND_A, reason: 'Separate' });
const annulInput = bondAnnulSchema.parse({ bondId: BOND_A, reason: 'Mistake' });

describe('mapBondRpcError', () => {
	it.each([
		[
			'42501',
			'permission denied: bond.annul is required',
			'permission',
			403,
			BOND_MESSAGES.permission
		],
		[
			'42501',
			'an active profile is required to change bonds',
			'permission',
			403,
			BOND_MESSAGES.permission
		],
		['P0002', 'campaign x not found', 'not_found', 404, BOND_MESSAGES.campaignNotFound],
		['P0002', 'bond x not found', 'not_found', 404, BOND_MESSAGES.bondNotFound],
		[
			'23514',
			'new row violates check constraint "bonds_total_value_positive"',
			'validation',
			400,
			BOND_MESSAGES.invalid
		],
		['XX000', 'boom', 'internal', 500, BOND_MESSAGES.internal]
	])('maps %s %j', (code, message, kind, status, text) => {
		const err = mapBondRpcError({ code, message });
		expect(err).toBeInstanceOf(BondServiceError);
		expect(err.kind).toBe(kind);
		expect(err.status).toBe(status);
		expect(err.message).toBe(text);
	});

	it.each([
		[
			'base number 5129 overflows: its associated number 10000 exceeds the campaign maximum number 9999',
			'Base number 5129 overflows: its associated number 10000 exceeds the campaign maximum number 9999.',
			'baseNumbers'
		],
		[
			'number 0005 appears more than once in this bond (2 as base, 0 as associated)',
			'Number 0005 appears more than once in this bond (2 as base, 0 as associated).',
			'baseNumbers'
		],
		[
			'a pata needs at least 2 simple bonds',
			'A pata needs at least 2 simple bonds.',
			'memberBondIds'
		],
		[
			`bond ${BOND_A} belongs to another campaign`,
			`Bond ${BOND_A} belongs to another campaign.`,
			'memberBondIds'
		],
		['a reason is required to annul a bond', 'A reason is required to annul a bond.', 'reason'],
		[
			`bond ${BOND_A} is not a manually grouped pata`,
			`Bond ${BOND_A} is not a manually grouped pata.`,
			'pataBondId'
		]
	])('maps 22023 %j to a validation error on its field', (message, text, field) => {
		const err = mapBondRpcError({ code: '22023', message });
		expect(err.kind).toBe('validation');
		expect(err.message).toBe(text);
		expect(err.field).toBe(field);
	});

	it('maps a duplicate number with every conflict from DETAIL', () => {
		const details = JSON.stringify({
			conflicts: [
				{ number: 68, formatted: '0068', bond_id: BOND_A, number_kind: 'base' },
				{ number: 4939, formatted: '4939', bond_id: BOND_A, number_kind: 'associated' }
			]
		});
		const err = mapBondRpcError(
			{ code: '23505', message: `number 0068 is already used by bond ${BOND_A}`, details },
			{ numberField: 'baseNumber' }
		);
		expect(err.kind).toBe('conflict');
		expect(err.status).toBe(409);
		expect(err.field).toBe('baseNumber');
		expect(err.message).toBe(`Numbers 0068, 4939 are already used by bond ${BOND_A}.`);
		const several = mapBondRpcError({
			code: '23505',
			message: 'x',
			details: JSON.stringify({
				conflicts: [
					{ number: 68, formatted: '0068', bond_id: BOND_A, number_kind: 'base' },
					{ number: 5000, formatted: '5000', bond_id: BOND_B, number_kind: 'base' }
				]
			})
		});
		expect(several.message).toBe(
			`Numbers 0068, 5000 are already used by other bonds in this campaign (0068: bond ${BOND_A}, 5000: bond ${BOND_B}).`
		);
		expect(err.conflicts).toEqual([
			{ number: 68, formatted: '0068', bondId: BOND_A, numberKind: 'base' },
			{ number: 4939, formatted: '4939', bondId: BOND_A, numberKind: 'associated' }
		]);
		expect(err.conflictingBondId).toBe(BOND_A);

		const single = mapBondRpcError({
			code: '23505',
			message: 'x',
			details: JSON.stringify({
				conflicts: [{ number: 68, formatted: '00068', bond_id: BOND_B, number_kind: 'base' }]
			})
		});
		expect(single.message).toBe(`Number 00068 is already used by bond ${BOND_B}.`);
		expect(single.field).toBe('baseNumbers');
	});

	it('maps duplicate codes to their field', () => {
		const internal = mapBondRpcError({
			code: '23505',
			message: `internal code INT-1 is already used by bond ${BOND_A}`,
			details: JSON.stringify({ internal_code: 'INT-1', bond_id: BOND_A })
		});
		expect(internal).toMatchObject({
			kind: 'conflict',
			field: 'internalCode',
			conflictingBondId: BOND_A
		});
		expect(internal.message).toBe(`Internal code INT-1 is already used by bond ${BOND_A}.`);

		const barcode = mapBondRpcError({
			code: '23505',
			message: `barcode BC is already used by bond ${BOND_B}`
		});
		expect(barcode).toMatchObject({ kind: 'conflict', field: 'barcode' });

		expect(
			mapBondRpcError({ code: '23505', message: 'duplicate key', details: 'not json' }).message
		).toBe(BOND_MESSAGES.duplicate);
	});

	it.each([
		[
			'bonds can only be changed while the campaign is draft or active (status: closing)',
			`${BOND_MESSAGES.campaignLocked} This campaign is closing.`
		],
		['a manually grouped pata cannot be annulled directly', BOND_MESSAGES.manualPataAnnul],
		[
			`only available bonds can be grouped (bond 1004 (${BOND_A}) is delivered_to_collector)`,
			`Only available bonds can be grouped (bond 1004 (${BOND_A}) is delivered to collector).`
		],
		[
			`bond 1000 (${BOND_A}) belongs to manually grouped pata ${BOND_B}`,
			`Bond 1000 (${BOND_A}) belongs to manually grouped pata ${BOND_B}. Ungroup the pata first.`
		],
		[
			`only an available pata can be ungrouped (pata ${BOND_A} is sold)`,
			`Only an available pata can be ungrouped (pata ${BOND_A} is sold).`
		]
	])('maps 55000 %j to a readable conflict', (message, text) => {
		const err = mapBondRpcError({ code: '55000', message });
		expect(err.kind).toBe('conflict');
		expect(err.message).toBe(text);
	});
});

describe('createBond', () => {
	it('sends the parsed numbers and codes and returns the new id', async () => {
		const { supabase, rpc } = rpcClient({ data: NEW_ID });
		await expect(createBond(supabase, simpleInput, { requestId: 'req-1' })).resolves.toBe(NEW_ID);
		expect(rpc).toHaveBeenCalledWith('bond_create', {
			p_campaign_id: CAMPAIGN_ID,
			p_base_numbers: [68],
			p_internal_code: 'INT-1',
			p_barcode: null,
			p_request_id: 'req-1',
			p_reason: null
		});
	});

	it('attributes duplicates to the pata field for a printed pata', async () => {
		const { supabase } = rpcClient({
			error: {
				code: '23505',
				message: 'number 0100 is already used by bond x',
				details: JSON.stringify({
					conflicts: [{ number: 100, formatted: '0100', bond_id: 'x', number_kind: 'base' }]
				})
			}
		});
		await expect(createBond(supabase, pataInput)).rejects.toMatchObject({
			kind: 'conflict',
			field: 'baseNumbers'
		});
	});

	it('checks the request permission list before calling the database', async () => {
		const { supabase, rpc } = rpcClient({ data: NEW_ID });
		await expect(
			createBond(supabase, simpleInput, { permissions: ['bond.view'] })
		).rejects.toMatchObject({
			kind: 'permission',
			status: 403
		});
		expect(rpc).not.toHaveBeenCalled();
		await expect(createBond(supabase, simpleInput, { permissions: ['bond.create'] })).resolves.toBe(
			NEW_ID
		);
	});

	it('fails as internal (500, not 403) when the request permission list failed to load', async () => {
		const { supabase, rpc } = rpcClient({ data: NEW_ID });
		await expect(createBond(supabase, simpleInput, { permissions: null })).rejects.toMatchObject({
			kind: 'internal',
			status: 500
		});
		expect(rpc).not.toHaveBeenCalled();
	});

	it('fails as internal when the RPC throws or returns no id', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(
			createBond(rpcClient(new Error('network')).supabase, simpleInput)
		).rejects.toMatchObject({
			kind: 'internal'
		});
		await expect(createBond(rpcClient({ data: null }).supabase, simpleInput)).rejects.toMatchObject(
			{
				kind: 'internal'
			}
		);
		spy.mockRestore();
	});
});

describe('groupBondsIntoPata / ungroupPata / annulBond', () => {
	it('groups members and returns the pata id', async () => {
		const { supabase, rpc } = rpcClient({ data: NEW_ID });
		await expect(groupBondsIntoPata(supabase, groupInput)).resolves.toBe(NEW_ID);
		expect(rpc).toHaveBeenCalledWith('bond_group_into_pata', {
			p_campaign_id: CAMPAIGN_ID,
			p_member_bond_ids: [BOND_A, BOND_B],
			p_internal_code: null,
			p_barcode: null,
			p_request_id: null,
			p_reason: 'Together'
		});
	});

	it('ungroups with the reason', async () => {
		const { supabase, rpc } = rpcClient({ data: null });
		await expect(ungroupPata(supabase, ungroupInput, { requestId: 'r' })).resolves.toBeUndefined();
		expect(rpc).toHaveBeenCalledWith('bond_ungroup_pata', {
			p_pata_bond_id: BOND_A,
			p_reason: 'Separate',
			p_request_id: 'r'
		});
	});

	it('annuls with the reason and requires bond.annul up front', async () => {
		const { supabase, rpc } = rpcClient({ data: null });
		await expect(annulBond(supabase, annulInput)).resolves.toBeUndefined();
		expect(rpc).toHaveBeenCalledWith('bond_annul', {
			p_bond_id: BOND_A,
			p_reason: 'Mistake',
			p_request_id: null
		});
		await expect(
			annulBond(supabase, annulInput, { permissions: ['bond.create'] })
		).rejects.toMatchObject({
			kind: 'permission'
		});
	});

	it('propagates mapped database errors', async () => {
		const { supabase } = rpcClient({
			error: { code: '55000', message: 'a manually grouped pata cannot be annulled directly' }
		});
		await expect(annulBond(supabase, annulInput)).rejects.toMatchObject({
			kind: 'conflict',
			message: BOND_MESSAGES.manualPataAnnul
		});
	});
});

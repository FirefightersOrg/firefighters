import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';
import {
	ADMIN_PERMISSIONS,
	CAMPAIGN_ID,
	campaignRow,
	makeLocals,
	mockSupabase,
	type ActionFailure
} from '../../../../test-helpers';

const PATA_ID = 'b0000000-0000-0000-0000-0000000000aa';
const A = 'b0000000-0000-0000-0000-000000000001';
const B = 'b0000000-0000-0000-0000-000000000002';
const C = 'b0000000-0000-0000-0000-000000000003';
const OTHER_PATA = 'b0000000-0000-0000-0000-0000000000bb';
const LOADER = [...ADMIN_PERMISSIONS, 'bond.view', 'bond.create'];
const OPERATOR = ['campaign.view', 'bond.view', 'bond.create'];

type QueryResult = { data: unknown; error: unknown };

/** A `bonds` row as `listGroupingMembers` selects it. */
function memberRow(
	id: string,
	base: number,
	overrides: {
		kind?: string;
		status?: string;
		pataId?: string;
		campaignId?: string;
	} = {}
) {
	return {
		id,
		campaign_id: overrides.campaignId ?? CAMPAIGN_ID,
		kind: overrides.kind ?? 'simple',
		commercial_status: overrides.status ?? 'available',
		internal_code: null,
		numbers:
			overrides.kind === 'pata'
				? []
				: [
						{ number_value: base, number_kind: 'base', released_at: null },
						{ number_value: base + 4871, number_kind: 'associated', released_at: null }
					],
		groups: overrides.pataId ? [{ pata_bond_id: overrides.pataId, ungrouped_at: null }] : []
	};
}

function setup(
	options: {
		campaign?: QueryResult;
		rpc?: QueryResult;
		bonds?: QueryResult;
		numbers?: QueryResult;
		permissions?: string[];
	} = {}
) {
	const mock = mockSupabase({
		tables: {
			campaigns: options.campaign ?? { data: campaignRow({ status: 'active' }), error: null },
			bonds: options.bonds ?? {
				data: [memberRow(A, 10), memberRow(B, 11)],
				error: null
			},
			bond_numbers: options.numbers ?? { data: [], error: null }
		},
		rpc: options.rpc ?? { data: PATA_ID, error: null }
	});
	const locals = makeLocals({
		supabase: mock.supabase,
		permissions: options.permissions ?? LOADER
	});
	return { ...mock, locals };
}

function loadEvent(locals: App.Locals, search = '', id = CAMPAIGN_ID) {
	return {
		locals,
		params: { id },
		url: new URL(`http://localhost:5173/campaigns/${id}/bonds/pata/new${search}`)
	} as unknown as Parameters<typeof load>[0];
}

function post(fields: Record<string, string | string[]>) {
	const body = new FormData();
	for (const [key, value] of Object.entries(fields)) {
		for (const v of Array.isArray(value) ? value : [value]) body.append(key, v);
	}
	return new Request(`http://localhost:5173/campaigns/${CAMPAIGN_ID}/bonds/pata/new`, {
		method: 'POST',
		body
	});
}

async function run(
	action: 'printed' | 'group',
	locals: App.Locals,
	fields: Record<string, string | string[]>,
	id = CAMPAIGN_ID
): Promise<ActionFailure & { redirect?: string }> {
	const event = {
		locals,
		params: { id },
		url: new URL(`http://localhost:5173/campaigns/${id}/bonds/pata/new?/${action}`),
		request: post(fields)
	} as unknown as Parameters<typeof actions.printed>[0];
	try {
		return (await actions[action](event)) as ActionFailure;
	} catch (err) {
		const thrown = err as { status?: number; location?: string };
		if (thrown?.status === 303) return { status: 303, data: {}, redirect: thrown.location };
		throw err;
	}
}

const printed = (fields: Record<string, string> = {}) => ({
	baseNumbers: '68, 69',
	internalCode: '',
	barcode: '',
	...fields
});
const group = (ids: string[] = [A, B], fields: Record<string, string> = {}) => ({
	memberBondIds: ids,
	internalCode: '',
	barcode: '',
	...fields
});

describe('/campaigns/[id]/bonds/pata/new', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	describe('load', () => {
		it('redirects anonymous users to login', async () => {
			await expect(load(loadEvent(makeLocals({ signedIn: false })))).rejects.toMatchObject({
				status: 303
			});
		});

		it('requires bond.create (403)', async () => {
			await expect(load(loadEvent(makeLocals({})))).rejects.toMatchObject({
				status: 403,
				body: { permission: 'bond.create' }
			});
			await expect(
				load(loadEvent(makeLocals({ permissions: ['campaign.view', 'bond.view'] })))
			).rejects.toMatchObject({ status: 403 });
		});

		it('returns 404 for a malformed id or a missing campaign', async () => {
			const { locals, from } = setup();
			await expect(load(loadEvent(locals, '', 'nope'))).rejects.toMatchObject({ status: 404 });
			expect(from).not.toHaveBeenCalled();
			const missing = setup({ campaign: { data: null, error: null } });
			await expect(load(loadEvent(missing.locals))).rejects.toMatchObject({ status: 404 });
		});

		it('defaults to the printed mode without querying bonds (operator)', async () => {
			const { locals, chains } = setup({ permissions: OPERATOR });
			const data = (await load(loadEvent(locals)))!;
			expect(data).toMatchObject({ mode: 'printed', canLoad: true, grouping: null });
			expect(chains.bond_numbers).toBeUndefined();
		});

		it('explains why patas cannot be loaded in a closed campaign', async () => {
			const { locals, chains } = setup({
				campaign: { data: campaignRow({ status: 'closed' }), error: null }
			});
			const data = (await load(loadEvent(locals, '?mode=grouping')))!;
			expect(data.canLoad).toBe(false);
			expect(data.grouping).toBeNull();
			expect(data.lockedMessage).toMatch(/La campaña está cerrada\.$/);
			expect(chains.bond_numbers).toBeUndefined();
		});

		it('grouping: searches available ungrouped simple bonds from a base number', async () => {
			const { locals, chains } = setup({
				numbers: {
					data: [
						{ number_value: 68, bond: { id: C, internal_code: 'X', barcode: null } },
						{ number_value: 70, bond: { id: A, internal_code: null, barcode: null } }
					],
					error: null
				},
				bonds: { data: [memberRow(A, 70)], error: null }
			});
			const data = (await load(
				loadEvent(locals, `?mode=grouping&q=68&selected=${A}&selected=bad`)
			))!;
			const search = chains.bond_numbers[0];
			expect(search.gte).toHaveBeenCalledWith('number_value', 68);
			expect(search.eq).toHaveBeenCalledWith('bond.kind', 'simple');
			expect(search.eq).toHaveBeenCalledWith('bond.commercial_status', 'available');
			expect(search.is).toHaveBeenCalledWith('bond.active', null);
			expect(search.limit).toHaveBeenCalledWith(21);
			expect(chains.bonds[0].in).toHaveBeenCalledWith('id', [A]);
			expect(data.grouping).toMatchObject({
				query: '68',
				searchError: null,
				// The picked bond is not offered again.
				results: [{ id: C, baseFormatted: '0068', associatedFormatted: '4939', internalCode: 'X' }],
				selected: [{ id: A, baseFormatted: '0070', associatedFormatted: '4941', problem: null }],
				unitCount: 1,
				totalValue: '60000.00'
			});
		});

		it('grouping: flags picked bonds that cannot be grouped, with the pata they are in', async () => {
			const { locals } = setup({
				bonds: {
					data: [
						memberRow(A, 10, { status: 'sold' }),
						memberRow(B, 11, { pataId: OTHER_PATA }),
						memberRow(C, 0, { kind: 'pata' })
					],
					error: null
				}
			});
			const data = (await load(loadEvent(locals, `?mode=grouping&selected=${A},${B},${C}`)))!;
			expect(data.grouping?.selected).toEqual([
				expect.objectContaining({
					id: A,
					problem: 'Está vendido: solo se pueden agrupar bonos disponibles.'
				}),
				expect.objectContaining({
					id: B,
					pataId: OTHER_PATA,
					problem: 'Ya pertenece a una pata. Desagrupar esa pata primero.'
				}),
				expect.objectContaining({
					id: C,
					problem: 'Es una pata: solo se pueden agrupar bonos simples.'
				})
			]);
			expect(data.grouping).toMatchObject({ unitCount: 3, totalValue: '180000.00' });
		});

		it('grouping: rejects a malformed search without querying', async () => {
			const { locals, chains } = setup();
			const data = (await load(loadEvent(locals, '?mode=grouping&q=12345')))!;
			expect(data.grouping?.searchError).toBe(
				'«12345» no es un número base válido (usar hasta 4 dígitos).'
			);
			expect(chains.bond_numbers).toBeUndefined();
		});

		it('grouping: 500 when the search fails', async () => {
			const { locals } = setup({ numbers: { data: null, error: { message: 'boom' } } });
			await expect(load(loadEvent(locals, '?mode=grouping'))).rejects.toMatchObject({
				status: 500
			});
		});
	});

	describe('printed action', () => {
		it('returns 403 without bond.create and touches nothing', async () => {
			const { supabase, rpc, from } = setup();
			const result = await run(
				'printed',
				makeLocals({ supabase, permissions: [...ADMIN_PERMISSIONS, 'bond.view'] }),
				printed()
			);
			expect(result.status).toBe(403);
			expect(result.data).toMatchObject({ form: 'pata', success: false });
			expect(rpc).not.toHaveBeenCalled();
			expect(from).not.toHaveBeenCalled();
		});

		it('creates the printed pata and opens it (operator)', async () => {
			const { locals, rpc } = setup({ permissions: OPERATOR });
			const result = await run(
				'printed',
				locals,
				printed({ baseNumbers: '68; 0069\n70', barcode: ' P-1 ' })
			);
			expect(result.redirect).toBe(`/campaigns/${CAMPAIGN_ID}/bonds/${PATA_ID}`);
			expect(rpc).toHaveBeenCalledWith('bond_create', {
				p_campaign_id: CAMPAIGN_ID,
				p_base_numbers: [68, 69, 70],
				p_internal_code: null,
				p_barcode: 'P-1',
				p_request_id: 'req-test',
				p_reason: null
			});
		});

		it('needs at least 2 base numbers', async () => {
			const { locals, rpc } = setup();
			const result = await run('printed', locals, printed({ baseNumbers: '68' }));
			expect(result.status).toBe(400);
			expect(result.data.errors).toEqual({
				baseNumbers: ['Una pata necesita al menos 2 números base']
			});
			expect(rpc).not.toHaveBeenCalled();
		});

		it('rejects an overflow or a number repeated inside the pata before calling the database', async () => {
			const { locals, rpc } = setup();
			const overflow = await run('printed', locals, printed({ baseNumbers: '68 5129' }));
			expect(overflow.status).toBe(400);
			expect((overflow.data.errors as Record<string, string[]>).baseNumbers[0]).toContain(
				'el número base más alto permitido es 5128'
			);
			// 4939 is 0068's associated number.
			const repeated = await run('printed', locals, printed({ baseNumbers: '68, 4939' }));
			expect(repeated.status).toBe(400);
			expect((repeated.data.errors as Record<string, string[]>).baseNumbers[0]).toBe(
				'El número 4939 aparece más de una vez en este bono (1 como base, 1 como asociado)'
			);
			expect(rpc).not.toHaveBeenCalled();
		});

		it('reports campaign-wide duplicates with the formatted numbers and links to their bonds', async () => {
			const { locals } = setup({
				rpc: {
					data: null,
					error: {
						code: '23505',
						message: `number 0068 is already used by bond ${A}`,
						details: JSON.stringify({
							conflicts: [
								{ number: 68, formatted: '0068', bond_id: A, number_kind: 'base' },
								{ number: 69, formatted: '0069', bond_id: B, number_kind: 'base' },
								{ number: 4939, formatted: '4939', bond_id: A, number_kind: 'associated' }
							]
						})
					}
				}
			});
			const result = await run('printed', locals, printed());
			expect(result.status).toBe(409);
			expect(result.data).toMatchObject({
				form: 'pata',
				errors: {
					baseNumbers: [
						'Los números 0068, 0069, 4939 ya están en uso en otros bonos de esta campaña.'
					]
				},
				conflicts: [
					{ field: 'baseNumbers', bondId: A, numbers: ['0068', '4939'] },
					{ field: 'baseNumbers', bondId: B, numbers: ['0069'] }
				],
				values: { baseNumbers: '68, 69', internalCode: '', barcode: '' }
			});
		});

		it('refuses when the campaign is not a draft or active', async () => {
			const { locals, rpc } = setup({
				campaign: { data: campaignRow({ status: 'closing' }), error: null }
			});
			const result = await run('printed', locals, printed());
			expect(result.status).toBe(409);
			expect(result.data.message).toMatch(/La campaña está en cierre\.$/);
			expect(rpc).not.toHaveBeenCalled();
		});
	});

	describe('group action', () => {
		it('returns 403 without bond.create', async () => {
			const { supabase, rpc } = setup();
			const result = await run(
				'group',
				makeLocals({ supabase, permissions: ['campaign.view', 'bond.view'] }),
				group()
			);
			expect(result.status).toBe(403);
			expect(result.data.form).toBe('group');
			expect(rpc).not.toHaveBeenCalled();
		});

		it('groups the picked bonds and opens the new pata', async () => {
			const { locals, rpc } = setup({ permissions: OPERATOR });
			const result = await run('group', locals, group([A, B], { internalCode: 'MP-1' }));
			expect(result.redirect).toBe(`/campaigns/${CAMPAIGN_ID}/bonds/${PATA_ID}`);
			expect(rpc).toHaveBeenCalledWith('bond_group_into_pata', {
				p_campaign_id: CAMPAIGN_ID,
				p_member_bond_ids: [A, B],
				p_internal_code: 'MP-1',
				p_barcode: null,
				p_request_id: 'req-test',
				p_reason: null
			});
		});

		it('needs at least 2 distinct bonds', async () => {
			const { locals, rpc } = setup();
			const one = await run('group', locals, group([A]));
			expect(one.status).toBe(400);
			expect(one.data.errors).toEqual({
				memberBondIds: ['Una pata necesita al menos 2 bonos simples']
			});
			const twice = await run('group', locals, group([A, A]));
			expect(twice.data.errors).toEqual({ memberBondIds: ['Un bono figura más de una vez'] });
			expect(rpc).not.toHaveBeenCalled();
		});

		it('rejects unavailable, already grouped, pata or foreign bonds with links to their pata', async () => {
			const { locals, rpc } = setup({
				bonds: {
					data: [
						memberRow(A, 10, { pataId: OTHER_PATA }),
						memberRow(B, 11, { pataId: OTHER_PATA }),
						memberRow(C, 12, { status: 'delivered_to_collector' })
					],
					error: null
				}
			});
			const result = await run('group', locals, group([A, B, C]));
			expect(result.status).toBe(409);
			expect(result.data).toMatchObject({
				form: 'group',
				errors: {
					memberBondIds: [
						'Bono 0010: Ya pertenece a una pata. Desagrupar esa pata primero.',
						'Bono 0011: Ya pertenece a una pata. Desagrupar esa pata primero.',
						'Bono 0012: Está entregado al cobrador: solo se pueden agrupar bonos disponibles.'
					]
				},
				conflicts: [{ field: 'memberBondIds', bondId: OTHER_PATA, numbers: ['0010', '0011'] }]
			});
			expect(rpc).not.toHaveBeenCalled();

			const foreign = setup({
				bonds: {
					data: [memberRow(A, 10, { campaignId: OTHER_PATA })],
					error: null
				}
			});
			const missing = await run('group', foreign.locals, group([A, B]));
			expect(missing.data.errors).toEqual({
				memberBondIds: [
					'Bono 0010: Pertenece a otra campaña.',
					'Un bono seleccionado: No se encontró el bono.'
				]
			});
		});

		it('maps a database rejection (changed meanwhile) without bond ids', async () => {
			const { locals } = setup({
				rpc: {
					data: null,
					error: {
						code: '55000',
						message: `bond 0010 (${A}) already belongs to manually grouped pata ${OTHER_PATA}`
					}
				}
			});
			const result = await run('group', locals, group());
			expect(result.status).toBe(409);
			expect(result.data.errors).toEqual({
				memberBondIds: ['El bono 0010 ya pertenece a una pata manual. Desagrupar la pata primero.']
			});
		});

		it('refuses when the campaign is closed', async () => {
			const { locals, rpc } = setup({
				campaign: { data: campaignRow({ status: 'closed' }), error: null }
			});
			const result = await run('group', locals, group());
			expect(result.status).toBe(409);
			expect(rpc).not.toHaveBeenCalled();
		});
	});
});

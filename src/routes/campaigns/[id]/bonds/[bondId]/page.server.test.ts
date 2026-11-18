import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';
import type { BondRecordMember, BondRecordNumber } from '$lib/components/bonds/record/types';
import {
	ADMIN_PERMISSIONS,
	CAMPAIGN_ID,
	campaignRow,
	makeLocals,
	mockSupabase,
	postRequest,
	profile,
	type ActionFailure
} from '../../../test-helpers';

const BOND_ID = 'b0000000-0000-0000-0000-000000000001';
const MEMBER_B = 'b0000000-0000-0000-0000-000000000002';
const PATA_ID = 'b0000000-0000-0000-0000-0000000000aa';
const ADMIN = [...ADMIN_PERMISSIONS, 'bond.view', 'bond.create', 'bond.annul', 'audit.view'];
const OPERATOR = ['campaign.view', 'bond.view', 'bond.create'];
const READ_ONLY = ['campaign.view', 'bond.view'];

type QueryResult = { data: unknown; error: unknown };

function bondRow(overrides: Record<string, unknown> = {}) {
	return {
		id: BOND_ID,
		campaign_id: CAMPAIGN_ID,
		kind: 'simple',
		origin: 'printed',
		internal_code: null,
		barcode: null,
		commercial_status: 'available',
		financial_status_snapshot: 'no_payments',
		current_collector_id: null,
		current_buyer_id: null,
		commercial_unit_count: 1,
		total_value: '60000.00',
		annulled_at: null,
		annulled_by: null,
		annul_reason: null,
		annulled_from_status: null,
		created_by: profile.id,
		created_at: '2026-11-17T12:00:00+00:00',
		updated_at: '2026-11-17T12:00:00+00:00',
		...overrides
	};
}

function numberRow(bondId: string, value: number, kind: string, released = false) {
	return {
		id: `${bondId}-${value}`,
		campaign_id: CAMPAIGN_ID,
		bond_id: bondId,
		number_value: value,
		number_kind: kind,
		source_base_number_id: null,
		created_at: '2026-11-17T12:00:00+00:00',
		released_at: released ? '2026-11-17T13:00:00+00:00' : null,
		released_by: released ? profile.id : null
	};
}

function groupRow(member: string, ungrouped: string | null = null) {
	return {
		id: `g-${member}`,
		pata_bond_id: PATA_ID,
		member_bond_id: member,
		grouped_at: '2026-11-17T12:00:00+00:00',
		grouped_by: profile.id,
		ungrouped_at: ungrouped,
		ungrouped_by: ungrouped ? profile.id : null,
		reason: ungrouped ? 'Loaded by mistake' : null
	};
}

function setup(
	options: {
		campaign?: QueryResult;
		bond?: QueryResult;
		numbers?: QueryResult;
		groups?: QueryResult;
		bondList?: QueryResult;
		audit?: QueryResult;
		rpc?: QueryResult;
		permissions?: string[];
	} = {}
) {
	const mock = mockSupabase({
		tables: {
			campaigns: options.campaign ?? { data: campaignRow({ status: 'active' }), error: null },
			bonds: options.bond ?? { data: bondRow(), error: null },
			bond_numbers: options.numbers ?? {
				data: [numberRow(BOND_ID, 68, 'base'), numberRow(BOND_ID, 4939, 'associated')],
				error: null
			},
			bond_groups: options.groups ?? { data: [], error: null },
			bond_list: options.bondList ?? { data: [], error: null },
			audit_log: options.audit ?? { data: [], error: null }
		},
		rpc: options.rpc ?? { data: null, error: null }
	});
	const locals = makeLocals({ supabase: mock.supabase, permissions: options.permissions ?? ADMIN });
	return { ...mock, locals };
}

function loadEvent(locals: App.Locals, bondId = BOND_ID, id = CAMPAIGN_ID) {
	return {
		locals,
		params: { id, bondId },
		url: new URL(`http://localhost:5173/campaigns/${id}/bonds/${bondId}`)
	} as unknown as Parameters<typeof load>[0];
}

function run(
	action: 'ungroup' | 'annul',
	locals: App.Locals,
	fields: Record<string, string>,
	bondId = BOND_ID,
	id = CAMPAIGN_ID
) {
	const url = `http://localhost:5173/campaigns/${id}/bonds/${bondId}?/${action}`;
	const event = {
		locals,
		params: { id, bondId },
		url: new URL(url),
		request: postRequest(url, fields)
	} as unknown as Parameters<typeof actions.annul>[0];
	return actions[action](event) as Promise<ActionFailure>;
}

describe('/campaigns/[id]/bonds/[bondId]', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	describe('load', () => {
		it('redirects anonymous users and requires bond.view', async () => {
			await expect(load(loadEvent(makeLocals({ signedIn: false })))).rejects.toMatchObject({
				status: 303
			});
			await expect(load(loadEvent(makeLocals({})))).rejects.toMatchObject({
				status: 403,
				body: { permission: 'bond.view' }
			});
		});

		it('returns 404 for malformed ids, a missing bond or a bond of another campaign', async () => {
			const { locals, from } = setup();
			await expect(load(loadEvent(locals, 'nope'))).rejects.toMatchObject({ status: 404 });
			await expect(load(loadEvent(locals, BOND_ID, 'nope'))).rejects.toMatchObject({
				status: 404
			});
			expect(from).not.toHaveBeenCalled();

			const missing = setup({ bond: { data: null, error: null } });
			await expect(load(loadEvent(missing.locals))).rejects.toMatchObject({
				status: 404,
				body: { message: expect.stringContaining('Bond not found') }
			});
			const foreign = setup({
				bond: {
					data: bondRow({ campaign_id: 'f0000000-0000-0000-0000-000000000009' }),
					error: null
				}
			});
			await expect(load(loadEvent(foreign.locals))).rejects.toMatchObject({ status: 404 });
		});

		it('returns 500 when the bond cannot be loaded', async () => {
			const { locals } = setup({ bond: { data: null, error: { message: 'boom' } } });
			await expect(load(loadEvent(locals))).rejects.toMatchObject({ status: 500 });
		});

		it('shows a simple bond with its formatted numbers; annul offered to admins only', async () => {
			const { locals } = setup();
			const data = (await load(loadEvent(locals)))!;
			expect(data.record.general).toMatchObject({
				typeLabel: 'Simple bond',
				commercialStatus: 'available',
				unitCount: 1,
				totalValue: '60000.00'
			});
			expect(data.record.numbers.map((n: BondRecordNumber) => [n.formatted, n.kind])).toEqual([
				['0068', 'base'],
				['4939', 'associated']
			]);
			expect(data.record.actions).toEqual({ ungroup: false, annul: true, lockedMessage: null });

			for (const permissions of [OPERATOR, READ_ONLY]) {
				const other = setup({ permissions });
				expect((await load(loadEvent(other.locals)))!.record.actions.annul).toBe(false);
			}
		});

		it('works with 5-digit numbers', async () => {
			const { locals } = setup({
				campaign: {
					data: campaignRow({
						number_digits: 5,
						max_number: 99999,
						associated_number_offset: 48710
					}),
					error: null
				},
				numbers: {
					data: [numberRow(BOND_ID, 68, 'base'), numberRow(BOND_ID, 48778, 'associated')],
					error: null
				}
			});
			const data = (await load(loadEvent(locals)))!;
			expect(data.record.numbers.map((n: BondRecordNumber) => n.formatted)).toEqual([
				'00068',
				'48778'
			]);
		});

		it('explains that a bond cannot be annulled once the campaign is closed', async () => {
			const { locals } = setup({
				campaign: { data: campaignRow({ status: 'closed' }), error: null }
			});
			const { actions: can } = (await load(loadEvent(locals)))!.record;
			expect(can.annul).toBe(false);
			expect(can.lockedMessage).toMatch(/This campaign is closed\.$/);
		});

		it('a member of a manual pata: shows the pata and no individual actions', async () => {
			const { locals } = setup({
				bondList: { data: [{ id: PATA_ID, base_numbers: [69, 68] }], error: null },
				groups: { data: [groupRow(BOND_ID), groupRow(MEMBER_B)], error: null },
				numbers: {
					data: [
						numberRow(BOND_ID, 68, 'base'),
						numberRow(BOND_ID, 4939, 'associated'),
						numberRow(MEMBER_B, 69, 'base'),
						numberRow(MEMBER_B, 4940, 'associated')
					],
					error: null
				}
			});
			const data = (await load(loadEvent(locals)))!;
			expect(data.record.group.memberOf).toEqual({ pataId: PATA_ID, label: '0068 + 0069' });
			expect(data.record.actions).toEqual({ ungroup: false, annul: false, lockedMessage: null });
		});

		it('a manual pata: members, their numbers, ungroup for bond.create, history', async () => {
			const { locals } = setup({
				permissions: OPERATOR,
				bond: {
					data: bondRow({
						id: PATA_ID,
						kind: 'pata',
						origin: 'manual_grouping',
						commercial_unit_count: 2,
						total_value: '120000.00'
					}),
					error: null
				},
				groups: { data: [groupRow(BOND_ID), groupRow(MEMBER_B)], error: null },
				numbers: {
					data: [
						numberRow(BOND_ID, 68, 'base'),
						numberRow(MEMBER_B, 69, 'base'),
						numberRow(BOND_ID, 4939, 'associated'),
						numberRow(MEMBER_B, 4940, 'associated')
					],
					error: null
				}
			});
			const data = (await load(loadEvent(locals, PATA_ID)))!;
			expect(data.record.general).toMatchObject({
				typeLabel: 'Manually grouped pata',
				unitCount: 2,
				totalValue: '120000.00'
			});
			expect(data.record.numbers.map((n: BondRecordNumber) => n.formatted)).toEqual([
				'0068',
				'4939',
				'0069',
				'4940'
			]);
			expect(
				data.record.group.members.map((m: BondRecordMember) => [m.baseFormatted, m.ungroupedAt])
			).toEqual([
				['0068', null],
				['0069', null]
			]);
			expect(data.record.actions).toEqual({ ungroup: true, annul: false, lockedMessage: null });

			const readOnly = setup({
				permissions: READ_ONLY,
				bond: {
					data: bondRow({
						id: PATA_ID,
						kind: 'pata',
						origin: 'manual_grouping',
						commercial_unit_count: 2,
						total_value: '120000.00'
					}),
					error: null
				}
			});
			expect((await load(loadEvent(readOnly.locals, PATA_ID)))!.record.actions.ungroup).toBe(false);
		});
		it('audit: not queried without audit.view; the record says so', async () => {
			const { locals, from } = setup({ permissions: OPERATOR });
			const data = (await load(loadEvent(locals)))!;
			expect(data.record.audit).toEqual({ allowed: false, entries: [], truncated: false });
			expect(from).not.toHaveBeenCalledWith('audit_log');
		});

		it('audit: own entries and the grouping entries of patas that list the bond', async () => {
			const OTHER = 'b0000000-0000-0000-0000-000000000099';
			const auditRow = (overrides: Record<string, unknown>) => ({
				id: 'a',
				action: 'bond.create',
				entity_type: 'bond',
				entity_id: BOND_ID,
				actor_user_id: profile.id,
				old_value: null,
				new_value: null,
				reason: null,
				created_at: '2026-11-17T12:00:00+00:00',
				request_id: null,
				actor: { full_name: 'Admin' },
				...overrides
			});
			const { locals, chains } = setup({
				groups: {
					data: [groupRow(BOND_ID, '2026-11-17T14:00:00+00:00')],
					error: null
				},
				bondList: { data: [{ id: PATA_ID, base_numbers: [68, 69] }], error: null },
				audit: {
					data: [
						auditRow({
							id: 'a3',
							action: 'bond.ungroup',
							entity_id: PATA_ID,
							old_value: { members: [BOND_ID, MEMBER_B] },
							new_value: { ungrouped_members: [BOND_ID, MEMBER_B] },
							reason: 'Wrong bonds',
							actor: null
						}),
						auditRow({
							id: 'a2',
							action: 'bond.group',
							entity_id: PATA_ID,
							new_value: { members: [BOND_ID, MEMBER_B] }
						}),
						// A pata entry that does not list this bond is left out.
						auditRow({
							id: 'ax',
							action: 'bond.group',
							entity_id: PATA_ID,
							new_value: { members: [OTHER, MEMBER_B] }
						}),
						auditRow({
							id: 'a1',
							new_value: { numbers: [{ number_value: 68, number_kind: 'base' }] },
							actor_user_id: null,
							actor: null
						})
					],
					error: null
				}
			});
			const data = (await load(loadEvent(locals)))!;
			const audit = chains.audit_log[0];
			expect(audit.eq).toHaveBeenCalledWith('entity_type', 'bond');
			expect(audit.in).toHaveBeenCalledWith('entity_id', [BOND_ID, PATA_ID]);
			const entries = data.record.audit.entries;
			expect(entries.map((e: { id: string }) => e.id)).toEqual(['a3', 'a2', 'a1']);
			expect(entries[0]).toMatchObject({
				actionLabel: 'Pata ungrouped',
				actorLabel: 'A user',
				reason: 'Wrong bonds',
				summary: 'This bond was freed from pata 0068 + 0069',
				viaPata: { pataId: PATA_ID, label: '0068 + 0069' }
			});
			expect(entries[1].actorLabel).toBe('Admin');
			expect(entries[2]).toMatchObject({
				actionLabel: 'Loaded',
				actorLabel: 'System',
				summary: 'Numbers 0068',
				viaPata: null
			});
			expect(data.record.group.pastPatas).toEqual([
				{
					pataId: PATA_ID,
					label: '0068 + 0069',
					groupedAt: '2026-11-17T12:00:00+00:00',
					ungroupedAt: '2026-11-17T14:00:00+00:00',
					reason: 'Loaded by mistake'
				}
			]);
		});

		it('fills the barcode, collector and buyer sections from the bond', async () => {
			const { locals } = setup({
				bond: { data: bondRow({ barcode: 'BC-1', internal_code: 'INT-1' }), error: null }
			});
			const { record } = (await load(loadEvent(locals)))!;
			expect(record.barcode).toEqual({
				barcode: 'BC-1',
				internalCode: 'INT-1',
				modeLabel: 'Barcode is the base number'
			});
			expect(record.collector).toEqual({ id: null });
			expect(record.buyer).toEqual({ id: null });
		});

		it('returns 500 when the audit log cannot be read', async () => {
			const { locals } = setup({ audit: { data: null, error: { message: 'boom' } } });
			await expect(load(loadEvent(locals))).rejects.toMatchObject({ status: 500 });
		});
	});

	describe.each(['ungroup', 'annul'] as const)(
		'%s action: scoped to the URL campaign',
		(action) => {
			const OTHER_CAMPAIGN = 'f0000000-0000-0000-0000-000000000009';

			it('404s without calling the service for a bond of another campaign', async () => {
				const { locals, rpc, from } = setup({
					bond: { data: { campaign_id: OTHER_CAMPAIGN }, error: null }
				});
				const result = await run(action, locals, { reason: 'x' });
				expect(result.status).toBe(404);
				expect(result.data).toMatchObject({
					form: action,
					success: false,
					message: expect.stringContaining('Bond not found')
				});
				expect(from).toHaveBeenCalledWith('bonds');
				expect(rpc).not.toHaveBeenCalled();
			});

			it('gives the same 404 for a bond that does not exist', async () => {
				const { locals, rpc } = setup({ bond: { data: null, error: null } });
				const result = await run(action, locals, { reason: 'x' });
				expect(result.status).toBe(404);
				expect(result.data.message).toEqual(expect.stringContaining('Bond not found'));
				expect(rpc).not.toHaveBeenCalled();
			});

			it('404s for a malformed campaign id or bond id without touching the database', async () => {
				for (const [bondId, id] of [
					[BOND_ID, 'nope'],
					['nope', CAMPAIGN_ID]
				]) {
					const { locals, rpc, from } = setup();
					const result = await run(action, locals, { reason: 'x' }, bondId, id);
					expect(result.status).toBe(404);
					expect(result.data).toMatchObject({ form: action, success: false });
					expect(from).not.toHaveBeenCalled();
					expect(rpc).not.toHaveBeenCalled();
				}
			});

			it('checks the permission first (403 before any lookup)', async () => {
				const { supabase, rpc, from } = setup();
				const result = await run(
					action,
					makeLocals({ supabase, permissions: READ_ONLY }),
					{ reason: 'x' },
					BOND_ID,
					'nope'
				);
				expect(result.status).toBe(403);
				expect(from).not.toHaveBeenCalled();
				expect(rpc).not.toHaveBeenCalled();
			});

			it('500s without calling the service when the bond cannot be read', async () => {
				const { locals, rpc } = setup({ bond: { data: null, error: { message: 'boom' } } });
				const result = await run(action, locals, { reason: 'x' });
				expect(result.status).toBe(500);
				expect(rpc).not.toHaveBeenCalled();
			});
		}
	);

	describe('ungroup action', () => {
		it('requires bond.create (403) and does not call the database', async () => {
			const { supabase, rpc } = setup();
			const result = await run(
				'ungroup',
				makeLocals({ supabase, permissions: READ_ONLY }),
				{ reason: 'x' },
				PATA_ID
			);
			expect(result.status).toBe(403);
			expect(result.data).toMatchObject({ form: 'ungroup', success: false });
			expect(rpc).not.toHaveBeenCalled();
		});

		it('requires a reason', async () => {
			const { locals, rpc } = setup({ permissions: OPERATOR });
			const result = await run('ungroup', locals, { reason: '   ' }, PATA_ID);
			expect(result.status).toBe(400);
			expect(result.data.errors).toEqual({ reason: ['A reason is required to ungroup a pata'] });
			expect(rpc).not.toHaveBeenCalled();
		});

		it('ungroups with the reason (operator)', async () => {
			const { locals, rpc } = setup({ permissions: OPERATOR });
			const result = await run('ungroup', locals, { reason: ' Wrong bonds ' }, PATA_ID);
			expect(result).toMatchObject({ form: 'ungroup', success: true });
			expect(rpc).toHaveBeenCalledWith('bond_ungroup_pata', {
				p_pata_bond_id: PATA_ID,
				p_reason: 'Wrong bonds',
				p_request_id: 'req-test'
			});
		});

		it('maps a database rejection without bond ids', async () => {
			const { locals } = setup({
				rpc: {
					data: null,
					error: {
						code: '55000',
						message: `only an available pata can be ungrouped (pata ${PATA_ID} is sold)`
					}
				}
			});
			const result = await run('ungroup', locals, { reason: 'x' }, PATA_ID);
			expect(result.status).toBe(409);
			expect(result.data.message).toBe(
				'Only an available pata can be ungrouped (this pata is sold).'
			);
		});
	});

	describe('annul action', () => {
		it('is admin-only: 403 for an operator', async () => {
			const { supabase, rpc } = setup();
			const result = await run('annul', makeLocals({ supabase, permissions: OPERATOR }), {
				reason: 'x'
			});
			expect(result.status).toBe(403);
			expect(rpc).not.toHaveBeenCalled();
		});

		it('requires a reason', async () => {
			const { locals, rpc } = setup();
			const result = await run('annul', locals, { reason: '' });
			expect(result.status).toBe(400);
			expect(result.data.errors).toEqual({ reason: ['A reason is required to annul a bond'] });
			expect(rpc).not.toHaveBeenCalled();
		});

		it('annuls with the reason', async () => {
			const { locals, rpc } = setup();
			const result = await run('annul', locals, { reason: 'Loaded twice' });
			expect(result).toEqual({
				form: 'annul',
				success: true,
				message: 'Bond annulled. Its numbers are free and can be entered again.',
				errors: {}
			});
			expect(rpc).toHaveBeenCalledWith('bond_annul', {
				p_bond_id: BOND_ID,
				p_reason: 'Loaded twice',
				p_request_id: 'req-test'
			});
		});

		it('explains a member of a manual pata or a closed campaign', async () => {
			const member = setup({
				rpc: {
					data: null,
					error: {
						code: '55000',
						message: `bond 0068 (${BOND_ID}) belongs to manually grouped pata ${PATA_ID}`
					}
				}
			});
			const result = await run('annul', member.locals, { reason: 'x' });
			expect(result.status).toBe(409);
			expect(result.data.message).toBe(
				'Bond 0068 belongs to a manually grouped pata. Ungroup the pata first.'
			);

			const closed = setup({
				rpc: {
					data: null,
					error: {
						code: '55000',
						message:
							'bonds can only be changed while the campaign is draft or active (status: closed)'
					}
				}
			});
			const locked = await run('annul', closed.locals, { reason: 'x' });
			expect(locked.data.message).toMatch(/This campaign is closed\.$/);
		});
	});
});

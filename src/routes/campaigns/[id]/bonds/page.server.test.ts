import { beforeEach, describe, expect, it, vi } from 'vitest';
import { load } from './+page.server';
import { CAMPAIGN_ID, campaignRow, makeLocals, mockSupabase } from '../../test-helpers';

const BOND_ID = 'b0000000-0000-0000-0000-000000000001';
const PATA_ID = 'b0000000-0000-0000-0000-0000000000aa';
const VIEWER = ['campaign.view', 'bond.view'];
const OPERATOR = [...VIEWER, 'bond.create'];

type QueryResult = { data: unknown; error: unknown };

function listRow(overrides: Record<string, unknown> = {}) {
	return {
		id: BOND_ID,
		campaign_id: CAMPAIGN_ID,
		kind: 'simple',
		origin: 'printed',
		internal_code: null,
		barcode: null,
		commercial_status: 'available',
		financial_status_snapshot: 'no_payments',
		commercial_unit_count: 1,
		total_value: '60000.00',
		created_at: '2026-11-17T12:00:00+00:00',
		base_numbers: [68],
		associated_numbers: [4939],
		group_pata_id: null,
		...overrides
	};
}

function setup(
	options: {
		campaign?: QueryResult;
		list?: QueryResult & { count?: number | null };
		permissions?: string[];
		/** Extra tables (bonds, collectors, buyers) for the names on each row. */
		tables?: Record<string, QueryResult>;
	} = {}
) {
	const list: QueryResult = options.list ?? { data: [listRow()], error: null, count: 1 };
	const mock = mockSupabase({
		tables: {
			campaigns: options.campaign ?? { data: campaignRow({ status: 'active' }), error: null },
			bond_list: list,
			...options.tables
		}
	});
	const locals = makeLocals({
		supabase: mock.supabase,
		permissions: options.permissions ?? OPERATOR
	});
	return { ...mock, locals };
}

function loadEvent(locals: App.Locals, search = '', id = CAMPAIGN_ID) {
	return {
		locals,
		params: { id },
		url: new URL(`http://localhost:5173/campaigns/${id}/bonds${search}`)
	} as unknown as Parameters<typeof load>[0];
}

describe('/campaigns/[id]/bonds', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	it('redirects anonymous users and requires campaign.view and bond.view', async () => {
		await expect(load(loadEvent(makeLocals({ signedIn: false })))).rejects.toMatchObject({
			status: 303
		});
		await expect(
			load(loadEvent(makeLocals({ permissions: ['campaign.view'] })))
		).rejects.toMatchObject({ status: 403, body: { permission: 'bond.view' } });
	});

	it('returns 404 for a malformed or missing campaign and 500 on a read error', async () => {
		const { locals, from } = setup();
		await expect(load(loadEvent(locals, '', 'nope'))).rejects.toMatchObject({ status: 404 });
		expect(from).not.toHaveBeenCalled();
		const missing = setup({ campaign: { data: null, error: null } });
		await expect(load(loadEvent(missing.locals))).rejects.toMatchObject({ status: 404 });
		const broken = setup({ list: { data: null, error: { message: 'boom' } } });
		await expect(load(loadEvent(broken.locals))).rejects.toMatchObject({ status: 500 });
	});

	it('lists the first page in a stable order, with the total and formatted numbers', async () => {
		const { locals, chains } = setup({
			list: { data: [listRow()], error: null, count: 26 }
		});
		const data = (await load(loadEvent(locals)))!;
		const chain = chains.bond_list[0];
		expect(chain.select).toHaveBeenCalledWith(expect.stringContaining('base_numbers'), {
			count: 'exact'
		});
		expect(chain.eq).toHaveBeenCalledWith('campaign_id', CAMPAIGN_ID);
		expect(chain.order.mock.calls).toEqual([
			['sort_number', { ascending: true, nullsFirst: false }],
			['created_at', { ascending: true }],
			['id', { ascending: true }]
		]);
		expect(chain.range).toHaveBeenCalledWith(0, 24);
		expect(chain.contains).not.toHaveBeenCalled();
		expect(data.pagination).toEqual({ page: 1, pageSize: 25, total: 26, pageCount: 2 });
		expect(data.bonds).toEqual([
			{
				id: BOND_ID,
				kind: 'simple',
				origin: 'printed',
				typeLabel: 'Bono simple',
				baseFormatted: ['0068'],
				associatedFormatted: ['4939'],
				internalCode: null,
				barcode: null,
				commercialStatus: 'available',
				financialStatus: 'no_payments',
				unitCount: 1,
				totalValue: '60000.00',
				inPata: null,
				collectorName: null,
				buyerName: null
			}
		]);
		expect(data.filtered).toBe(false);
		expect(data.can.create).toBe(true);
	});

	it('applies every filter from the query string (padded or not) and the page', async () => {
		const { locals, chains } = setup();
		const data = (await load(
			loadEvent(
				locals,
				'?base=0068&associated=4939&code=A,B%22c&type=pata&status=sold&financial=overdue&page=3'
			)
		))!;
		const chain = chains.bond_list[0];
		expect(chain.contains.mock.calls).toEqual([
			['base_numbers', [68]],
			['associated_numbers', [4939]]
		]);
		expect(chain.or).toHaveBeenCalledWith('barcode.eq."A,B\\"c",internal_code.eq."A,B\\"c"');
		expect(chain.eq.mock.calls).toEqual([
			['campaign_id', CAMPAIGN_ID],
			['kind', 'pata'],
			['commercial_status', 'sold'],
			['financial_status_snapshot', 'overdue']
		]);
		expect(chain.range).toHaveBeenCalledWith(50, 74);
		expect(data.query.values).toEqual({
			base: '0068',
			associated: '4939',
			code: 'A,B"c',
			type: 'pata',
			status: 'sold',
			financial: 'overdue',
			collector: ''
		});
		expect(data.filtered).toBe(true);
	});

	it('does not query with invalid filters and explains them', async () => {
		const { locals, chains } = setup();
		const data = (await load(
			loadEvent(locals, '?base=12345&associated=x&type=grouped&status=nope&page=-1')
		))!;
		expect(chains.bond_list).toBeUndefined();
		expect(data.query.errors).toEqual({
			base: 'Ingresar un número entre 0000 y 9999.',
			associated: 'Ingresar un número entre 0000 y 9999.',
			type: 'Elegir una de las opciones de la lista.',
			status: 'Elegir una de las opciones de la lista.'
		});
		expect(data.bonds).toEqual([]);
		expect(data.pagination.page).toBe(1);
	});

	describe('collector filter', () => {
		const COLLECTOR = 'c0000000-0000-0000-0000-0000000000c1';

		it('filters by current_collector_id and names the collector', async () => {
			const { locals, chains } = setup({
				tables: {
					collectors: { data: [{ id: COLLECTOR, display_name: 'Héctor Acosta' }], error: null }
				}
			});
			const data = (await load(loadEvent(locals, `?collector=${COLLECTOR}&page=2`)))!;
			expect(chains.bond_list[0].eq).toHaveBeenCalledWith('current_collector_id', COLLECTOR);
			expect(chains.bond_list[0].range).toHaveBeenCalledWith(25, 49);
			expect(data.filterCollectorName).toBe('Héctor Acosta');
			expect(data.query.values.collector).toBe(COLLECTOR);
			expect(data.filtered).toBe(true);
		});

		it('refuses an id that is not a uuid without querying', async () => {
			const { locals, chains } = setup();
			const data = (await load(loadEvent(locals, '?collector=drop%20table')))!;
			expect(chains.bond_list).toBeUndefined();
			expect(data.query.errors.collector).toBeTruthy();
			expect(data.bonds).toEqual([]);
		});

		it('gives an empty list, not an error, for an unknown collector', async () => {
			const { locals } = setup({
				list: { data: [], error: null, count: 0 },
				tables: { collectors: { data: [], error: null } }
			});
			const data = (await load(loadEvent(locals, `?collector=${COLLECTOR}`)))!;
			expect(data.bonds).toEqual([]);
			expect(data.pagination.total).toBe(0);
			expect(data.filterCollectorName).toBeNull();
		});

		it('still lists the bonds when the collector name cannot be read', async () => {
			const { locals } = setup({
				tables: { collectors: { data: null, error: { message: 'permission denied' } } }
			});
			const data = (await load(loadEvent(locals, `?collector=${COLLECTOR}`)))!;
			expect(data.bonds).toHaveLength(1);
			expect(data.filterCollectorName).toBeNull();
		});

		it('still requires bond.view', async () => {
			const { locals } = setup({ permissions: ['campaign.view'] });
			await expect(load(loadEvent(locals, `?collector=${COLLECTOR}`))).rejects.toMatchObject({
				status: 403
			});
		});
	});

	it('names the manual pata of a grouped member and labels patas', async () => {
		const { locals, chains } = setup({
			list: {
				data: [
					listRow({ group_pata_id: PATA_ID }),
					listRow({
						id: PATA_ID,
						kind: 'pata',
						origin: 'manual_grouping',
						commercial_unit_count: 2,
						total_value: '120000.00',
						base_numbers: [68, 69],
						associated_numbers: [4939, 4940]
					})
				],
				error: null,
				count: 2
			}
		});
		const data = (await load(loadEvent(locals)))!;
		// Second bond_list read: the base numbers of the patas of the listed members.
		expect(chains.bond_list[1].in).toHaveBeenCalledWith('id', [PATA_ID]);
		expect(data.bonds[0].inPata).toEqual({ pataId: PATA_ID, label: '0068 + 0069' });
		expect(data.bonds[1]).toMatchObject({
			typeLabel: 'Pata agrupada manualmente',
			baseFormatted: ['0068', '0069']
		});
	});

	it('offers creation only with bond.create while the campaign is draft or active', async () => {
		const viewer = setup({ permissions: VIEWER });
		expect((await load(loadEvent(viewer.locals)))!.can.create).toBe(false);
		const closed = setup({ campaign: { data: campaignRow({ status: 'closed' }), error: null } });
		expect((await load(loadEvent(closed.locals)))!.can.create).toBe(false);
	});

	it('works with 5-digit numbers', async () => {
		const { locals, chains } = setup({
			campaign: {
				data: campaignRow({ number_digits: 5, max_number: 99999, associated_number_offset: 48710 }),
				error: null
			},
			list: {
				data: [listRow({ base_numbers: [68], associated_numbers: [48778] })],
				error: null,
				count: 1
			}
		});
		// With a second filter, so the single match stays in the list (see the redirect below).
		const data = (await load(loadEvent(locals, '?base=00068&status=available')))!;
		expect(chains.bond_list[0].contains).toHaveBeenCalledWith('base_numbers', [68]);
		expect(data.bonds[0].baseFormatted).toEqual(['00068']);
		expect(data.bonds[0].associatedFormatted).toEqual(['48778']);
	});

	describe('a search by number alone (UX plan PR 9)', () => {
		const one = { data: [listRow()], error: null, count: 1 };

		it('goes straight to the record when exactly one bond matches', async () => {
			await expect(load(loadEvent(setup({ list: one }).locals, '?base=68'))).rejects.toMatchObject({
				status: 303,
				location: `/campaigns/${CAMPAIGN_ID}/bonds/${BOND_ID}`
			});
			// An empty filter left in the form does not count as another filter.
			await expect(
				load(loadEvent(setup({ list: one }).locals, '?base=0068&associated=&type='))
			).rejects.toMatchObject({ status: 303 });
		});

		it.each([
			['another filter', '?base=68&status=available'],
			['a page', '?base=68&page=1'],
			['a different filter alone', '?associated=4939'],
			['no filter', '']
		])('keeps the list with %s', async (_case, search) => {
			const data = (await load(loadEvent(setup({ list: one }).locals, search)))!;
			expect(data.bonds).toHaveLength(1);
		});

		it('keeps the list when nothing or more than one bond matches', async () => {
			const none = (await load(
				loadEvent(setup({ list: { data: [], error: null, count: 0 } }).locals, '?base=68')
			))!;
			expect(none.bonds).toEqual([]);
			const several = (await load(
				loadEvent(
					setup({
						list: { data: [listRow(), listRow({ id: PATA_ID })], error: null, count: 2 }
					}).locals,
					'?base=68'
				)
			))!;
			expect(several.bonds).toHaveLength(2);
		});
	});

	describe('who has each bond and who bought it (audit A7)', () => {
		const COLLECTOR = 'c0000000-0000-0000-0000-000000000001';
		const BUYER = 'd0000000-0000-0000-0000-000000000001';
		const holders = {
			bonds: {
				data: [{ id: BOND_ID, current_collector_id: COLLECTOR, current_buyer_id: BUYER }],
				error: null
			},
			collectors: { data: [{ id: COLLECTOR, display_name: 'Héctor Acosta' }], error: null },
			buyers: {
				data: [{ id: BUYER, first_name: 'Stella', last_name: 'Rodríguez', business_name: null }],
				error: null
			}
		};

		it('names them on the row', async () => {
			const data = (await load(loadEvent(setup({ tables: holders }).locals)))!;
			expect(data.bonds[0]).toMatchObject({
				collectorName: 'Héctor Acosta',
				buyerName: 'Stella Rodríguez'
			});
		});

		it('leaves the names out when they cannot be read, and still lists the bonds', async () => {
			const hidden = setup({
				tables: {
					...holders,
					collectors: { data: null, error: { message: 'permission denied' } },
					buyers: { data: [], error: null }
				}
			});
			const data = (await load(loadEvent(hidden.locals)))!;
			expect(data.bonds[0]).toMatchObject({ collectorName: null, buyerName: null });
			expect(data.bonds).toHaveLength(1);
		});

		it('reads no names for an empty page', async () => {
			const { locals, from } = setup({ list: { data: [], error: null, count: 0 } });
			await load(loadEvent(locals));
			const tables = from.mock.calls.map((call: unknown[]) => call[0]);
			for (const table of ['bonds', 'collectors', 'buyers']) expect(tables).not.toContain(table);
		});
	});
});

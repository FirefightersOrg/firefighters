import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { resolveSeedConfig } from '../../scripts/seed-admin';

/**
 * SAN-151: circular associated number mode against the local Supabase, with the seeded admin.
 * B = 5000 (max 9999), offset 4871: 0129 -> 5000, 0068 -> 9939, 0000 -> 9871, 0128 -> 9999.
 *
 * Bonds cannot be deleted: every run creates its own campaigns (`it circular <run id>`).
 */
const { supabaseUrl, anonKey, serviceRoleKey, seedEnv } = inject('integrationEnv');
const config = resolveSeedConfig(seedEnv);
const run = randomUUID().slice(0, 8);

let admin: SupabaseClient;
let service: SupabaseClient;

async function createCampaign(
	label: string,
	mode: 'linear' | 'circular',
	max = 9999,
	offset = 4871
) {
	const created = await admin.rpc('campaign_create', {
		p_name: `it circular ${label} ${run}`,
		p_simple_bond_value: '60000.00',
		p_installment_count: 10,
		p_number_digits: 4,
		p_max_number: max,
		p_associated_number_offset: offset,
		p_overflow_policy: 'reject',
		p_barcode_mode: 'base_number',
		p_starts_at: '2027-03-01T00:00:00-03:00',
		p_ends_at: '2027-12-31T23:59:59-03:00',
		p_associated_number_mode: mode
	});
	if (created.error) throw new Error(created.error.message);
	return created.data as string;
}

async function numbersOf(campaignId: string) {
	const { data, error } = await service
		.from('bond_numbers')
		.select('bond_id, number_value, number_kind')
		.eq('campaign_id', campaignId)
		.order('number_value');
	if (error) throw new Error(error.message);
	return data as { bond_id: string; number_value: number; number_kind: string }[];
}

beforeAll(async () => {
	const anon = createClient(supabaseUrl, anonKey, {
		auth: { autoRefreshToken: false, persistSession: false }
	});
	const { data, error } = await anon.auth.signInWithPassword({
		email: config.admin.email,
		password: config.admin.password
	});
	if (error || !data.session) throw new Error('Unable to sign in as the seeded admin');
	admin = createClient(supabaseUrl, anonKey, {
		global: { headers: { Authorization: `Bearer ${data.session.access_token}` } }
	});
	service = createClient(supabaseUrl, serviceRoleKey, {
		auth: { autoRefreshToken: false, persistSession: false }
	});
});

describe('circular associated number mode (local Supabase)', () => {
	let campaignId: string;
	const bondIdByBase = new Map<number, string>();

	it('creates a circular campaign and rejects invalid circular rules', async () => {
		campaignId = await createCampaign('main', 'circular');
		const row = await service
			.from('campaigns')
			.select('associated_number_mode')
			.eq('id', campaignId)
			.single();
		expect(row.data?.associated_number_mode).toBe('circular');

		const even = await admin.rpc('campaign_create', {
			p_name: `it circular bad ${run}`,
			p_simple_bond_value: '60000.00',
			p_installment_count: 10,
			p_number_digits: 4,
			p_max_number: 9998,
			p_associated_number_offset: 100,
			p_overflow_policy: 'reject',
			p_barcode_mode: 'base_number',
			p_associated_number_mode: 'circular'
		});
		expect(even.error?.message).toContain('campaigns_circular_max_number_even_range');
	});

	it('bond_create stores the circular associated numbers, wrap-around bases included', async () => {
		for (const [base, associated] of [
			[0, 9871],
			[68, 9939],
			[128, 9999],
			[129, 5000]
		] as const) {
			const created = await admin.rpc('bond_create', {
				p_campaign_id: campaignId,
				p_base_numbers: [base]
			});
			expect(created.error, `base ${base}`).toBeNull();
			bondIdByBase.set(base, created.data as string);
			const numbers = await service
				.from('bond_numbers')
				.select('number_value, number_kind')
				.eq('bond_id', created.data as string);
			expect(
				numbers.data?.map((n) => [n.number_kind, n.number_value]).sort(),
				`base ${base}`
			).toEqual([
				['associated', associated],
				['base', base]
			]);
		}
	});

	it('rejects a base from B up (22023) and keeps the linear rejection for linear campaigns', async () => {
		const circular = await admin.rpc('bond_create', {
			p_campaign_id: campaignId,
			p_base_numbers: [5000]
		});
		expect(circular.error?.code).toBe('22023');
		expect(circular.error?.message).toContain('outside the circular range');

		const linearId = await createCampaign('linear', 'linear');
		const overflow = await admin.rpc('bond_create', {
			p_campaign_id: linearId,
			p_base_numbers: [5129]
		});
		expect(overflow.error?.code).toBe('22023');
		expect(overflow.error?.message).toContain('overflows');
		const ok = await admin.rpc('bond_create', { p_campaign_id: linearId, p_base_numbers: [5128] });
		expect(ok.error).toBeNull();
		expect((await numbersOf(linearId)).map((n) => n.number_value)).toEqual([5128, 9999]);
	});

	it('freezes the mode once the campaign has bonds', async () => {
		const { error } = await admin.rpc('campaign_update_rules', {
			p_id: campaignId,
			p_simple_bond_value: '60000.00',
			p_installment_count: 10,
			p_number_digits: 4,
			p_max_number: 9999,
			p_associated_number_offset: 4871,
			p_overflow_policy: 'reject',
			p_barcode_mode: 'base_number',
			p_expected_updated_at: (
				await service.from('campaigns').select('updated_at').eq('id', campaignId).single()
			).data?.updated_at,
			p_associated_number_mode: 'linear'
		});
		expect(error?.code).toBe('55000');
	});

	it('imports circular bonds (barcode = base number) and confirms them with the circular N2', async () => {
		const importCampaign = await createCampaign('import', 'circular');
		const session = await admin.rpc('import_session_create', {
			p_campaign_id: importCampaign,
			p_source_type: 'csv_file',
			p_file_name: 'circular.csv'
		});
		expect(session.error).toBeNull();
		const sessionId = session.data as string;
		const staged = await admin.rpc('import_session_add_items', {
			p_session_id: sessionId,
			p_rows: [
				{ row_number: 1, item_type: 'simple', barcode: '0000' },
				{ row_number: 2, item_type: 'simple', barcode: '0068' },
				{ row_number: 3, item_type: 'simple', barcode: '0129' },
				{ row_number: 4, item_type: 'simple', barcode: '5001' }
			]
		});
		expect(staged.error).toBeNull();

		// A base from B up fails the preview; the other rows are valid.
		const first = await admin.rpc('import_session_validate', { p_session_id: sessionId });
		expect(first.error).toBeNull();
		expect(first.data.valid).toBe(false);
		const items = await service
			.from('import_session_items')
			.select('row_number, status, error_code')
			.eq('import_session_id', sessionId)
			.order('row_number');
		expect(items.data?.map((i) => [i.row_number, i.status, i.error_code])).toEqual([
			[1, 'valid', null],
			[2, 'valid', null],
			[3, 'valid', null],
			[4, 'error', 'number_out_of_range']
		]);

		const bad = await service
			.from('import_session_items')
			.select('id')
			.eq('import_session_id', sessionId)
			.eq('row_number', 4)
			.single();
		const removed = await admin.rpc('import_session_remove_item', { p_item_id: bad.data?.id });
		expect(removed.error).toBeNull();

		const second = await admin.rpc('import_session_validate', { p_session_id: sessionId });
		expect(second.error).toBeNull();
		expect(second.data.valid).toBe(true);
		const confirmed = await admin.rpc('import_session_confirm', { p_session_id: sessionId });
		expect(confirmed.error).toBeNull();
		expect(confirmed.data.bonds_created).toBe(3);

		const numbers = await numbersOf(importCampaign);
		expect(numbers.map((n) => n.number_value)).toEqual([0, 68, 129, 5000, 9871, 9939]);
	});

	it('finds the winner of a draw by N2 for a wrap-around bond (0068 -> 9939) and by N1', async () => {
		const draw = await admin.rpc('draw_create', {
			p_campaign_id: campaignId,
			p_draw_type: 'final',
			p_name: `Circular ${run}`,
			p_draw_date: '2027-12-20',
			p_payment_cutoff_at: '2027-12-15T23:59:59-03:00',
			p_required_installment_number: null,
			p_eligibility_rule: {}
		});
		expect(draw.error).toBeNull();
		expect((await admin.rpc('draw_generate_roster', { p_draw_id: draw.data })).error).toBeNull();
		expect((await admin.rpc('draw_freeze_roster', { p_draw_id: draw.data })).error).toBeNull();

		const prize = await admin.rpc('prize_create', {
			p_draw_id: draw.data,
			p_name: 'Primer premio',
			p_description: null,
			p_position: 1
		});
		expect(prize.error).toBeNull();
		const loaded = await admin.rpc('draw_load_winning_number', {
			p_prize_id: prize.data,
			p_number_value: 9939,
			p_notes: null
		});
		expect(loaded.error).toBeNull();
		const winner = await admin
			.from('winning_numbers')
			.select('number_value, matched_roster_entry_id')
			.eq('id', loaded.data)
			.single();
		expect(winner.data?.number_value).toBe(9939);
		const entry = await admin
			.from('draw_roster_entries')
			.select('bond_id, number_value')
			.eq('id', winner.data?.matched_roster_entry_id)
			.single();
		expect(entry.data?.number_value).toBe(9939);
		expect(entry.data?.bond_id).toBe(bondIdByBase.get(68));

		// N1 of another bond.
		const second = await admin.rpc('prize_create', {
			p_draw_id: draw.data,
			p_name: 'Segundo premio',
			p_description: null,
			p_position: 2
		});
		const loadedBase = await admin.rpc('draw_load_winning_number', {
			p_prize_id: second.data,
			p_number_value: 129,
			p_notes: null
		});
		expect(loadedBase.error).toBeNull();
		const matched = await admin
			.from('winning_numbers')
			.select('matched_roster_entry_id')
			.eq('id', loadedBase.data)
			.single();
		const baseEntry = await admin
			.from('draw_roster_entries')
			.select('bond_id')
			.eq('id', matched.data?.matched_roster_entry_id)
			.single();
		expect(baseEntry.data?.bond_id).toBe(bondIdByBase.get(129));
	});
});

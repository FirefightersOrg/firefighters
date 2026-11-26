/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { isHttpError } from '@sveltejs/kit';
import ExcelJS from 'exceljs';
import {
	REPORT_EXPORT_KEYS,
	REPORT_EXPORTS,
	type ReportExportKey
} from '$lib/domain/report-exports';
import { todayInBuenosAires } from '$lib/domain/reports';
import { createDraw } from '$lib/server/services/draws';
import { freezeDrawRoster, generateDrawRoster } from '$lib/server/services/draw-rosters';
import { createPrize, loadWinningNumber } from '$lib/server/services/prizes';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import { loadPermissions } from './permissions';
import type { UserProfile } from '../../src/app';
import { load as dashboardLoad } from '../../src/routes/campaigns/[id]/+page.server';
import { load as operationalLoad } from '../../src/routes/campaigns/[id]/reports/+page.server';
import { load as financialLoad } from '../../src/routes/campaigns/[id]/reports/financial/+page.server';
import { GET as exportReport } from '../../src/routes/campaigns/[id]/reports/export/[report]/+server';

/**
 * Phase 13 acceptance (SAN-88): the dashboard (SAN-85), the operational reports (SAN-86), the
 * financial and draw reports and the CSV/Excel exports (SAN-87) are enough to run a campaign
 * without Excel. Everything runs against the local Supabase with the seeded users, through the real
 * route loads and the real export endpoint. One fixture is built once in `beforeAll` (read-only for
 * the tests) so every figure can be compared across screens; each test only reads, so order is
 * irrelevant. The fixture uses relative dates and a 2099 campaign end: nothing expires.
 */
const { supabaseUrl, anonKey, seedEnv } = inject('integrationEnv');
const seed = resolveSeedConfig(seedEnv);
const options = { auth: { autoRefreshToken: false, persistSession: false } };
const RUN_ID = randomUUID().slice(0, 8);
let sequence = 0;
const rid = (label: string) => `it-p13-${RUN_ID}-${String(++sequence).padStart(3, '0')}-${label}`;

type Role = 'admin' | 'operator' | 'treasurer' | 'read-only' | 'collector';
const ROLES: Role[] = ['admin', 'operator', 'treasurer', 'read-only', 'collector'];
interface Caller {
	user: User;
	client: SupabaseClient;
	profile: UserProfile;
	permissions: string[];
}
const users = {} as Record<Role, Caller>;

const today = todayInBuenosAires();
const dayShift = (days: number) =>
	new Date(Date.parse(`${today}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const yesterday = dayShift(-1);
/** The cash payment is dated in the past on purpose: the reports must group by payment date. */
const CASH_DATE = dayShift(-20);
const BUYER_FORMULA = `=cmd|${RUN_ID}`;

let campaignId: string;
let otherCampaignId: string;
let emptyCampaignId: string;
let collectorId: string;
let otherDrawId: string;
let drawId: string;
const NO_CAMPAIGN = '00000000-0000-4000-8000-00000000dead';

async function signIn(role: Role, email: string, password: string): Promise<Caller> {
	const anon = createClient(supabaseUrl, anonKey, options);
	const { data, error } = await anon.auth.signInWithPassword({ email, password });
	if (error || !data.session || !data.user) throw new Error(`Unable to sign in as ${role}`);
	const client = createClient(supabaseUrl, anonKey, {
		...options,
		global: { headers: { Authorization: `Bearer ${data.session.access_token}` } }
	});
	const { data: profile, error: profileError } = await client
		.from('profiles')
		.select('*')
		.eq('auth_user_id', data.user.id)
		.single();
	if (profileError || !profile) throw new Error(`No profile for ${role}`);
	return {
		user: data.user,
		client,
		profile: profile as UserProfile,
		permissions: await loadPermissions(client)
	};
}

async function rpc<T = string>(name: string, args: Record<string, unknown>): Promise<T> {
	const { data, error } = await users.admin.client.rpc(name, args);
	if (error) throw new Error(`${name}: ${error.message}`);
	return data as T;
}

interface Opts {
	id?: string;
	search?: string;
	permissions?: string[] | null;
}
function locals(caller: Caller, opts: Opts) {
	return {
		supabase: caller.client,
		safeGetSession: async () => ({ session: null, user: caller.user }),
		session: null,
		user: caller.user,
		profile: caller.profile,
		permissions: opts.permissions === undefined ? caller.permissions : opts.permissions,
		requestId: rid('route')
	};
}
function pageEvent(caller: Caller, path: string, opts: Opts = {}) {
	const id = opts.id ?? campaignId;
	return {
		locals: locals(caller, opts),
		params: { id },
		url: new URL(`http://localhost/campaigns/${id}${path}${opts.search ?? ''}`)
	} as any;
}
const dashboard = (c: Caller, o: Opts = {}) => dashboardLoad(pageEvent(c, '', o)) as Promise<any>;
const operational = (c: Caller, o: Opts = {}) =>
	operationalLoad(pageEvent(c, '/reports', o)) as Promise<any>;
const financial = (c: Caller, o: Opts = {}) =>
	financialLoad(pageEvent(c, '/reports/financial', o)) as Promise<any>;
async function exportCall(caller: Caller, report: string, format: 'csv' | 'xlsx', o: Opts = {}) {
	const id = o.id ?? campaignId;
	const search = `${o.search ?? ''}${o.search ? '&' : '?'}format=${format}`;
	return await exportReport({
		locals: locals(caller, o),
		params: { id, report },
		url: new URL(`http://localhost/campaigns/${id}/reports/export/${report}${search}`)
	} as any);
}

/** Resolves to the HTTP status and body of a thrown SvelteKit error, or 200 with the value. */
async function outcome<T>(fn: () => Promise<T>) {
	try {
		return { status: 200, value: await fn(), body: null as unknown };
	} catch (err) {
		if (isHttpError(err))
			return { status: err.status, value: undefined, body: err.body as unknown };
		throw err;
	}
}

// RFC 4180 reader written here (not the production writer's inverse) so the CSV is read like Excel would.
function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]!;
		if (quoted) {
			if (ch === '"' && text[i + 1] === '"') {
				cell += '"';
				i++;
			} else if (ch === '"') quoted = false;
			else cell += ch;
		} else if (ch === '"') quoted = true;
		else if (ch === ',') {
			row.push(cell);
			cell = '';
		} else if (ch === '\r' && text[i + 1] === '\n') {
			row.push(cell);
			rows.push(row);
			row = [];
			cell = '';
			i++;
		} else cell += ch;
	}
	if (cell !== '' || row.length) {
		row.push(cell);
		rows.push(row);
	}
	return rows;
}

async function csvOf(caller: Caller, report: string, o: Opts = {}) {
	const response = await exportCall(caller, report, 'csv', o);
	const bytes = new Uint8Array(await response.arrayBuffer());
	expect([...bytes.slice(0, 3)], 'UTF-8 BOM').toEqual([0xef, 0xbb, 0xbf]);
	expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
	const table = parseCsv(new TextDecoder().decode(bytes.slice(3)));
	return { header: table[0]!, rows: table.slice(1), response };
}
async function xlsxOf(caller: Caller, report: string, o: Opts = {}) {
	const response = await exportCall(caller, report, 'xlsx', o);
	expect(response.headers.get('content-type')).toBe(
		'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
	);
	const workbook = new ExcelJS.Workbook();
	await workbook.xlsx.load((await response.arrayBuffer()) as ArrayBuffer);
	expect(workbook.worksheets).toHaveLength(1);
	const sheet = workbook.worksheets[0]!;
	const table: unknown[][] = [];
	sheet.eachRow((row) => table.push((row.values as unknown[]).slice(1)));
	return { header: table[0] as string[], rows: table.slice(1), response };
}
const cents = (value: string | number) => Math.round(Number(value) * 100);
const sumCents = (values: Array<string | number>) =>
	values.reduce<number>((n, v) => n + cents(v), 0);
const money = (c: number) => (c / 100).toFixed(2);

async function createCampaign(label: string, value = '300.00', installments = 3) {
	const id = await rpc('campaign_create', {
		p_name: `[it-p13 ${RUN_ID}] ${label}`,
		p_simple_bond_value: value,
		p_installment_count: installments,
		p_number_digits: 4,
		p_max_number: 9999,
		p_associated_number_offset: 1,
		p_overflow_policy: 'reject',
		p_barcode_mode: 'base_number',
		p_starts_at: '2026-01-01T03:00:00Z',
		p_ends_at: '2099-12-31T03:00:00Z',
		p_request_id: rid(`campaign-${label}`)
	});
	await rpc('campaign_transition', {
		p_id: id,
		p_to_status: 'active',
		p_request_id: rid(`activate-${label}`)
	});
	return id;
}

/** Delivers a bond to the collector, sells it and pays installment 1 in an (open) settlement. */
async function soldAndPaid(
	campaign: string,
	collector: string,
	settlement: string,
	base: number,
	buyerFirstName: string,
	method: 'cash' | 'transfer',
	paymentDate: string,
	amount = 100
) {
	const buyer = await rpc('buyer_create', {
		p_type: 'individual',
		p_first_name: buyerFirstName,
		p_last_name: RUN_ID,
		p_business_name: null,
		p_document_number: null,
		p_tax_id: null,
		p_phone: null,
		p_address: null,
		p_usual_collector_id: null,
		p_notes: null,
		p_request_id: rid(`buyer-${base}`)
	});
	const bond = await rpc('bond_create', {
		p_campaign_id: campaign,
		p_base_numbers: [base],
		p_request_id: rid(`bond-${base}`)
	});
	await rpc('bond_deliver', {
		p_campaign_id: campaign,
		p_collector_id: collector,
		p_bond_ids: [bond],
		p_notes: null,
		p_request_id: rid(`deliver-${base}`)
	});
	const sale = await rpc('sale_register', {
		p_campaign_id: campaign,
		p_bond_id: bond,
		p_buyer_id: buyer,
		p_payment_mode: 'installments',
		p_first_due_date: today,
		p_sale_date: paymentDate,
		p_request_id: rid(`sale-${base}`)
	});
	const { data: rows, error } = await users.admin.client
		.from('installments')
		.select('id,payment_plans!inner(sale_id)')
		.eq('payment_plans.sale_id', sale)
		.eq('installment_number', 1);
	if (error || rows?.length !== 1) throw new Error(`installment 1 of ${base}: ${error?.message}`);
	await rpc('settlement_add_payment', {
		p_settlement_id: settlement,
		p_sale_id: sale,
		p_amount: amount,
		p_payment_method: method,
		p_payment_date: paymentDate,
		p_applications: [{ installment_id: rows[0]!.id, amount_applied: amount }],
		p_request_id: rid(`pay-${base}`)
	});
	return bond;
}

async function newCollector(label: string) {
	return rpc('collector_create', {
		p_display_name: `${label} ${RUN_ID}`,
		p_phone: null,
		p_email: null,
		p_address: null,
		p_user_profile_id: null,
		p_status: 'active',
		p_request_id: rid(`collector-${label}`)
	});
}

const svc = (label: string) => ({ requestId: rid(label), permissions: users.admin.permissions });

beforeAll(async () => {
	users.admin = await signIn('admin', seed.admin.email, seed.admin.password);
	for (const role of ['operator', 'treasurer', 'read-only', 'collector'] as const) {
		const fixture = seed.fixtures.find((item) => item.roleNames.includes(role))!;
		users[role] = await signIn(role, fixture.email, fixture.password);
	}
	campaignId = await createCampaign('main');
	otherCampaignId = await createCampaign('other', '250.00', 1);
	emptyCampaignId = await createCampaign('empty');
	collectorId = await newCollector('Phase13');

	// Main campaign: 4 bonds. 1 available, 4 delivered, 7 sold (cash 100, dated 20 days ago, buyer
	// name starts with `=`), 10 sold (transfer 100 today). One closed settlement, 10% rule.
	await rpc('commission_rule_create', {
		p_campaign_id: campaignId,
		p_rule_type: 'installment_first',
		p_installment_number: null,
		p_percentage: '10',
		p_fixed_amount: null,
		p_valid_from: '2026-01-01',
		p_valid_to: null,
		p_request_id: rid('rule'),
		p_reason: null
	});
	await rpc('bond_create', {
		p_campaign_id: campaignId,
		p_base_numbers: [1],
		p_request_id: rid('bond-1')
	});
	const delivered = await rpc('bond_create', {
		p_campaign_id: campaignId,
		p_base_numbers: [4],
		p_request_id: rid('bond-4')
	});
	await rpc('bond_deliver', {
		p_campaign_id: campaignId,
		p_collector_id: collectorId,
		p_bond_ids: [delivered],
		p_notes: null,
		p_request_id: rid('deliver-4')
	});
	const settlement = await rpc('settlement_open', {
		p_campaign_id: campaignId,
		p_collector_id: collectorId,
		p_notes: null,
		p_request_id: rid('settlement')
	});
	await soldAndPaid(campaignId, collectorId, settlement, 7, BUYER_FORMULA, 'cash', CASH_DATE);
	await soldAndPaid(campaignId, collectorId, settlement, 10, 'Bravo', 'transfer', today);
	await rpc('settlement_close', { p_settlement_id: settlement, p_request_id: rid('close') });

	// Frozen-roster draw with one prize won by bond 7 (its base number is a participating number).
	const cutoff = `${today}T23:59:59-03:00`;
	drawId = await createDraw(
		users.admin.client,
		{
			campaignId,
			drawType: 'final',
			name: 'Sorteo P13',
			drawDate: yesterday,
			paymentCutoffAt: cutoff,
			requiredInstallmentNumber: 1,
			eligibilityRule: {}
		},
		svc('draw')
	);
	await generateDrawRoster(users.admin.client, { drawId }, svc('roster'));
	await freezeDrawRoster(users.admin.client, { drawId }, svc('freeze'));
	const prizeId = await createPrize(
		users.admin.client,
		{ drawId, name: 'Premio P13', description: null, position: 1 },
		svc('prize')
	);
	await loadWinningNumber(users.admin.client, { prizeId, numberValue: 7, notes: null }, svc('win'));

	// Another campaign with its own (larger) money and its own draw: must never leak into the main one.
	const otherCollector = await newCollector('OtherCampaign');
	const otherSettlement = await rpc('settlement_open', {
		p_campaign_id: otherCampaignId,
		p_collector_id: otherCollector,
		p_notes: null,
		p_request_id: rid('other-settlement')
	});
	await soldAndPaid(
		otherCampaignId,
		otherCollector,
		otherSettlement,
		50,
		'Other',
		'cash',
		today,
		250
	);
	await rpc('settlement_close', {
		p_settlement_id: otherSettlement,
		p_request_id: rid('other-close')
	});
	otherDrawId = await createDraw(
		users.admin.client,
		{
			campaignId: otherCampaignId,
			drawType: 'final',
			name: 'Sorteo ajeno',
			drawDate: yesterday,
			paymentCutoffAt: cutoff,
			requiredInstallmentNumber: 1,
			eligibilityRule: {}
		},
		svc('other-draw')
	);
}, 180_000);

afterAll(() => vi.useRealTimers());

// What every screen and export must agree on (derived from the fixture above, not from the reports).
const EXPECTED = {
	bonds: 4,
	sold: 2,
	delivered: 1,
	available: 1,
	cash: '100.00',
	transfer: '100.00',
	collected: '200.00',
	expected: '600.00',
	pending: '400.00'
};

describe('Phase 13: reports, dashboard and exports without Excel', () => {
	describe('C1 dashboard reconciles with the confirmed records (SAN-85)', () => {
		it('matches the fixture and the underlying tables', async () => {
			const { operational: op, financial: fin } = (await dashboard(users.admin)).dashboard;
			expect(op.bonds).toMatchObject({
				total: EXPECTED.bonds,
				sold: EXPECTED.sold,
				delivered: EXPECTED.delivered,
				available: EXPECTED.available
			});
			expect(op.revenue).toMatchObject({
				expected: EXPECTED.expected,
				collected: EXPECTED.collected,
				pending: EXPECTED.pending,
				collectedPercent: 33
			});
			expect(fin.cash).toEqual({ cash: '100.00', transfer: '100.00', total: '200.00' });
			expect(fin.commissions).toMatchObject({ closedSettlements: 1, openSettlements: 0 });

			// Independent read of the confirmed records through the admin's own RLS access.
			const { data: payments, error } = await users.admin.client
				.from('payments')
				.select('amount,payment_method,status,settlements!inner(campaign_id,status)')
				.eq('settlements.campaign_id', campaignId);
			if (error) throw error;
			const confirmed = (payments ?? []).filter((p: any) => p.status === 'confirmed');
			expect(sumCents(confirmed.map((p: any) => p.amount))).toBe(cents(fin.cash.total));
			const { count } = await users.admin.client
				.from('bonds')
				.select('id', { count: 'exact', head: true })
				.eq('campaign_id', campaignId);
			expect(count).toBe(op.bonds.total);
		});

		it('is scoped to its campaign: the other campaign (250.00 cash) does not leak in', async () => {
			const other = (await dashboard(users.admin, { id: otherCampaignId })).dashboard;
			expect(other.financial.cash).toEqual({ cash: '250.00', transfer: '0.00', total: '250.00' });
			expect(other.operational.bonds.total).toBe(1);
			const empty = (await dashboard(users.admin, { id: emptyCampaignId })).dashboard;
			expect(empty.operational.bonds.total).toBe(0);
			expect(empty.financial.cash.total).toBe('0.00');
		});
	});

	describe('C2 operational reports (SAN-86)', () => {
		it('reports bonds, collectors, installments and the monthly summary from the fixture', async () => {
			const data = await operational(users.admin);
			expect(data.bondsByStatus.bondCount).toBe(EXPECTED.bonds);
			expect(data.bondsByStatus.totalValue).toBe('1200.00');
			expect(data.bondsByCollector.totals).toMatchObject({
				bondCount: 4,
				deliveredCount: 1,
				soldCount: 2,
				soldValue: '600.00'
			});
			// The available bond has no collector: it is the "unassigned" row.
			const unassigned = data.bondsByCollector.rows.find((r: any) => r.collectorId === null);
			expect(unassigned).toMatchObject({ bondCount: 1, soldCount: 0 });
			const mine = data.bondsByCollector.rows.find((r: any) => r.collectorId === collectorId);
			expect(mine).toMatchObject({
				bondCount: 3,
				deliveredCount: 1,
				soldCount: 2,
				soldValue: '600.00'
			});
			expect(data.installments.totals.paid).toEqual({ count: 2, amount: '200.00' });
			expect(data.monthly.totals).toMatchObject({
				paymentsCount: 2,
				paymentsTotal: EXPECTED.collected,
				paymentsCash: EXPECTED.cash,
				paymentsTransfer: EXPECTED.transfer
			});
		});

		it('filters by collector and by commercial status, and excludes other collectors', async () => {
			const sold = await operational(users.admin, { search: '?status=sold' });
			expect(sold.bondsByStatus.bondCount).toBe(EXPECTED.sold);
			const none = await operational(users.admin, { search: `?collector=${randomUUID()}` });
			expect(none.bondsByStatus.bondCount).toBe(0);
		});
	});

	describe('C3 financial and draw reports (SAN-87)', () => {
		it('reports payments by Buenos Aires payment date, settlements, accounts, rosters and prizes', async () => {
			const data = await financial(users.admin);
			expect(data.payments.days).toEqual([
				{ paymentDate: CASH_DATE, cash: '100.00', transfer: '0.00', total: '100.00', count: 1 },
				{ paymentDate: today, cash: '0.00', transfer: '100.00', total: '100.00', count: 1 }
			]);
			expect(data.settlements.rows).toHaveLength(1);
			expect(data.settlements.rows[0]).toMatchObject({
				collectorId,
				status: 'closed',
				settlementCount: 1,
				totalCash: '100.00',
				totalTransfer: '100.00',
				totalAmount: '200.00',
				commissionAmount: '20.00'
			});
			expect(data.accounts.rows).toHaveLength(1);
			expect(data.accounts.rows[0]).toMatchObject({ collectorId });
			expect(data.draws).toHaveLength(1);
			expect(data.draws[0]).toMatchObject({
				drawId,
				drawName: 'Sorteo P13',
				rosterStatus: 'frozen'
			});
			expect(data.prizes.rows).toHaveLength(1);
			expect(data.prizes.rows[0]).toMatchObject({
				drawId,
				prizeName: 'Premio P13',
				winningNumber: 7
			});
			expect(data.canExport).toBe(true);
		});

		it('applies the date range and method filters inclusively', async () => {
			const onlyCash = await financial(users.admin, {
				search: `?from=${CASH_DATE}&to=${CASH_DATE}`
			});
			expect(onlyCash.payments.totals.total).toBe('100.00');
			expect(onlyCash.payments.days.map((d: any) => d.paymentDate)).toEqual([CASH_DATE]);
			const before = await financial(users.admin, { search: `?to=${dayShift(-21)}` });
			expect(before.payments.days).toEqual([]);
			const transfer = await financial(users.admin, { search: '?method=transfer' });
			expect(transfer.payments.totals.total).toBe('100.00');
		});

		it('shows the account detail of a collector and the roster of a draw', async () => {
			const data = await financial(users.admin, {
				search: `?collector=${collectorId}&draw=${drawId}`
			});
			expect(Array.isArray(data.ledger)).toBe(true);
			expect(data.ledger.length).toBeGreaterThan(0);
			expect(data.roster.map((r: any) => r.numberValue)).toContain(7);
			expect(data.roster.every((r: any) => typeof r.eligible === 'boolean')).toBe(true);
		});
	});

	describe('C4 exports open without Excel: CSV parsed, xlsx read with exceljs', () => {
		const searchFor = (key: ReportExportKey) =>
			key === 'collector-ledger'
				? `?collector=${collectorId}`
				: key === 'draw-roster'
					? `?draw=${drawId}`
					: '';

		it.each(REPORT_EXPORT_KEYS)(
			'%s: header, row count and values agree in CSV and xlsx',
			async (key) => {
				const columns = REPORT_EXPORTS[key].columns;
				const headers = columns.map((c) => c.header);
				const search = searchFor(key);
				const csv = await csvOf(users.admin, key, { search });
				const xlsx = await xlsxOf(users.admin, key, { search });
				expect(csv.header).toEqual(headers);
				expect(xlsx.header).toEqual(headers);
				expect(csv.rows.length).toBe(xlsx.rows.length);
				// The fixture's installments are not overdue, so the overdue list (SAN-149) is legitimately
				// empty here; operational-reports.test.ts covers it with real rows.
				if (key !== 'overdue-sales') expect(csv.rows.length).toBeGreaterThan(0);
				for (const row of csv.rows) expect(row).toHaveLength(headers.length);
				// Numeric columns: exact decimal text in CSV, the same number in Excel (never text).
				columns.forEach((column, index) => {
					if (!column.numeric) return;
					csv.rows.forEach((row, r) => {
						const cell = xlsx.rows[r]![index];
						if (row[index] === '') return expect(cell ?? null).toBeNull();
						expect(typeof cell, `${key} ${column.header} row ${r}`).toBe('number');
						expect(cell).toBeCloseTo(Number(row[index]), 2);
					});
				});
				const name = csv.response.headers.get('content-disposition');
				expect(name).toBe(
					`attachment; filename="report-${key}-${campaignId.slice(0, 8)}-${today}.csv"`
				);
				expect(csv.response.headers.get('cache-control')).toBe('no-store');
			}
		);

		it('exports payments with the exact cents, the Spanish-neutral date and the screen filters', async () => {
			const all = await csvOf(users.treasurer, 'payments-by-date');
			expect(all.rows.map((r) => r.join('|')).sort()).toEqual(
				[`${CASH_DATE}|Cash|1|100.00`, `${today}|Transfer|1|100.00`].sort()
			);
			const filtered = await csvOf(users.treasurer, 'payments-by-date', { search: '?method=cash' });
			expect(filtered.rows).toEqual([[CASH_DATE, 'Cash', '1', '100.00']]);
			const xlsx = await xlsxOf(users.treasurer, 'payments-by-date', { search: '?method=cash' });
			expect(xlsx.rows).toEqual([[CASH_DATE, 'Cash', 1, 100]]);
		});

		it('neutralizes formulas in free text in both formats', async () => {
			const csv = await csvOf(users.admin, 'draw-roster', { search: `?draw=${drawId}` });
			const buyerIndex = csv.header.indexOf('Buyer');
			const buyers = csv.rows.map((r) => r[buyerIndex]);
			expect(buyers).toContain(`'${BUYER_FORMULA} ${RUN_ID}`);
			expect(buyers.filter((b) => b?.startsWith('='))).toEqual([]);
			const xlsx = await xlsxOf(users.admin, 'draw-roster', { search: `?draw=${drawId}` });
			const xBuyers = xlsx.rows.map((r) => r[buyerIndex]);
			expect(xBuyers).toContain(`'${BUYER_FORMULA} ${RUN_ID}`);
			expect(xBuyers.filter((b) => typeof b === 'string' && b.startsWith('='))).toEqual([]);
		});

		it('rejects a missing collector/draw (400), unknown report (404) and bad format (400)', async () => {
			expect((await outcome(() => exportCall(users.admin, 'collector-ledger', 'csv'))).status).toBe(
				400
			);
			expect((await outcome(() => exportCall(users.admin, 'draw-roster', 'csv'))).status).toBe(400);
			expect((await outcome(() => exportCall(users.admin, 'nope', 'csv'))).status).toBe(404);
			expect(
				(await outcome(() => exportCall(users.admin, 'prizes', 'csv', { search: '?format=pdf' })))
					.status
			).toBe(400);
		});
	});

	describe('C5 totals are consistent across reports, dashboard and exports', () => {
		it('money: the same collected amount everywhere', async () => {
			const fin = await financial(users.admin);
			const op = await operational(users.admin);
			const dash = (await dashboard(users.admin)).dashboard;
			const paymentsCsv = await csvOf(users.admin, 'payments-by-date');
			const paymentsXlsx = await xlsxOf(users.admin, 'payments-by-date');
			const settlementsCsv = await csvOf(users.admin, 'settlements-by-collector');
			const monthlyCsv = await csvOf(users.admin, 'collector-monthly');
			const installmentsCsv = await csvOf(users.admin, 'installments');
			const col = (t: { header: string[]; rows: unknown[][] }, name: string) =>
				t.rows.map((r) => r[t.header.indexOf(name)] as string | number);

			const figures = {
				paymentsReport: cents(fin.payments.totals.total),
				settlementsReport: cents(fin.settlements.totals.totalAmount),
				dashboardCash: cents(dash.financial.cash.total),
				dashboardRevenue: cents(dash.operational.revenue.collected),
				monthlyReport: cents(op.monthly.totals.paymentsTotal),
				installmentsPaid: cents(op.installments.totals.paid.amount),
				paymentsCsv: sumCents(col(paymentsCsv, 'Total')),
				paymentsXlsx: sumCents(col(paymentsXlsx, 'Total')),
				settlementsCsv: sumCents(col(settlementsCsv, 'Total')),
				monthlyCsv: sumCents(col(monthlyCsv, 'Payments total')),
				installmentsCsv: sumCents(
					installmentsCsv.rows
						.filter((r) => r[installmentsCsv.header.indexOf('Bucket')] === 'Pagadas')
						.map((r) => r[installmentsCsv.header.indexOf('Amount')]!)
				)
			};
			for (const [name, value] of Object.entries(figures)) {
				expect(money(value), name).toBe(EXPECTED.collected);
			}
		});

		it('bonds: the same count and value everywhere', async () => {
			const op = await operational(users.admin);
			const dash = (await dashboard(users.admin)).dashboard;
			const statusCsv = await csvOf(users.admin, 'bonds-by-status');
			const collectorCsv = await csvOf(users.admin, 'bonds-by-collector');
			const bonds = statusCsv.rows.reduce(
				(n, r) => n + Number(r[statusCsv.header.indexOf('Bonds')]),
				0
			);
			expect(bonds).toBe(EXPECTED.bonds);
			expect(op.bondsByStatus.bondCount).toBe(EXPECTED.bonds);
			expect(dash.operational.bonds.total).toBe(EXPECTED.bonds);
			expect(
				money(sumCents(statusCsv.rows.map((r) => r[statusCsv.header.indexOf('Total value')]!)))
			).toBe('1200.00');
			// By collector: 3 bonds are with the collector and 1 is in the unassigned row.
			const assigned = collectorCsv.rows.reduce(
				(n, r) => n + Number(r[collectorCsv.header.indexOf('Bonds')]),
				0
			);
			expect(assigned).toBe(EXPECTED.bonds);
			expect(assigned).toBe(op.bondsByCollector.totals.bondCount);
			expect(dash.operational.bonds.sold).toBe(op.bondsByCollector.totals.soldCount);
		});

		it('commission and account: settlement commission equals the ledger credit', async () => {
			const fin = await financial(users.admin, { search: `?collector=${collectorId}` });
			const account = fin.accounts.rows[0];
			const csv = await csvOf(users.admin, 'collector-ledger', {
				search: `?collector=${collectorId}`
			});
			const amount = csv.header.indexOf('Amount');
			const direction = csv.header.indexOf('Direction');
			expect(csv.rows.length).toBe(account.entryCount);
			const last = csv.rows.at(-1)!;
			expect(money(cents(last[csv.header.indexOf('Running balance')]!))).toBe(account.balance);
			expect(csv.rows.every((r) => r[amount] !== '' && r[direction] !== '')).toBe(true);
			expect(fin.settlements.rows[0].commissionAmount).toBe('20.00');
		});
	});

	describe('C6 permissions: allowed roles read, denied roles get 403 with no data', () => {
		const OPERATIONAL = [
			'bonds-by-status',
			'bonds-by-collector',
			'installments',
			'overdue-sales',
			'collector-monthly'
		];
		// role -> [can view operational, can view financial, can export]
		const MATRIX: Record<Role, [boolean, boolean, boolean]> = {
			admin: [true, true, true],
			operator: [true, false, true],
			treasurer: [true, true, true],
			'read-only': [true, true, true],
			collector: [false, false, false]
		};
		// Anything from the fixture that must never appear in a refusal.
		const SECRETS = [RUN_ID, '100.00', '200.00', 'Phase13', 'Premio P13', 'Sorteo P13'];

		it.each(ROLES)('%s: operational and financial pages', async (role) => {
			const [op, fin] = MATRIX[role];
			const o = await outcome(() => operational(users[role]));
			const f = await outcome(() => financial(users[role]));
			expect(o.status).toBe(op ? 200 : 403);
			expect(f.status).toBe(fin ? 200 : 403);
			for (const denied of [o, f].filter((x) => x.status !== 200)) {
				const text = JSON.stringify(denied.body);
				for (const secret of SECRETS) expect(text).not.toContain(secret);
			}
			if (o.status === 200) expect(o.value.bondsByStatus.bondCount).toBe(EXPECTED.bonds);
			if (f.status === 200) expect(f.value.payments.totals.total).toBe(EXPECTED.collected);
		});

		it.each(ROLES)('%s: every export', async (role) => {
			const [op, fin, canExport] = MATRIX[role];
			for (const key of REPORT_EXPORT_KEYS) {
				const viewable = OPERATIONAL.includes(key) ? op : fin;
				const search =
					key === 'collector-ledger'
						? `?collector=${collectorId}`
						: key === 'draw-roster'
							? `?draw=${drawId}`
							: '';
				const result = await outcome(() => exportCall(users[role], key, 'csv', { search }));
				expect(result.status, `${role} ${key}`).toBe(canExport && viewable ? 200 : 403);
				if (result.status === 403) {
					const text = JSON.stringify(result.body);
					for (const secret of SECRETS) expect(text).not.toContain(secret);
				}
			}
		});

		it('dashboard: groups follow the report permissions and a collector sees none', async () => {
			expect(await dashboard(users.operator)).toMatchObject({
				dashboard: { financial: null, operational: { bonds: { total: EXPECTED.bonds } } }
			});
			expect((await dashboard(users.treasurer)).dashboard.financial.cash.total).toBe('200.00');
			expect((await dashboard(users['read-only'])).dashboard.operational).not.toBeNull();
			expect((await dashboard(users.collector)).dashboard).toEqual({
				operational: null,
				financial: null
			});
		});

		it('database: the report functions refuse a role without the permission (42501)', async () => {
			const denied = await users.operator.client.rpc('report_payments_by_date', {
				p_campaign_id: campaignId,
				p_collector_id: null,
				p_method: null,
				p_from: null,
				p_to: null
			});
			expect(denied.error?.code).toBe('42501');
			expect(denied.data).toBeNull();
			const collector = await users.collector.client.rpc('report_prizes', {
				p_campaign_id: campaignId,
				p_draw_id: null,
				p_prize_status: null
			});
			expect(collector.data ?? null).toBeNull();
			expect(collector.error).not.toBeNull();
		});

		it('null permissions answer 500 on every report, export and the dashboard', async () => {
			const permissions = null;
			expect((await outcome(() => operational(users.admin, { permissions }))).status).toBe(500);
			expect((await outcome(() => financial(users.admin, { permissions }))).status).toBe(500);
			expect((await outcome(() => dashboard(users.admin, { permissions }))).status).toBe(500);
			for (const key of REPORT_EXPORT_KEYS) {
				expect(
					(await outcome(() => exportCall(users.admin, key, 'csv', { permissions }))).status,
					key
				).toBe(500);
			}
		});
	});

	describe('C7 campaign scoping answers 404 and never mixes campaigns', () => {
		it('unknown and malformed campaign ids are 404 on pages, dashboard and exports', async () => {
			for (const id of [NO_CAMPAIGN, 'not-a-uuid']) {
				expect((await outcome(() => operational(users.admin, { id }))).status).toBe(404);
				expect((await outcome(() => financial(users.admin, { id }))).status).toBe(404);
				expect((await outcome(() => dashboard(users.admin, { id }))).status).toBe(404);
				expect((await outcome(() => exportCall(users.admin, 'prizes', 'csv', { id }))).status).toBe(
					404
				);
			}
		});

		it('a draw of another campaign is 404 in the page and in the export', async () => {
			expect(
				(await outcome(() => financial(users.admin, { search: `?draw=${otherDrawId}` }))).status
			).toBe(404);
			expect(
				(
					await outcome(() =>
						exportCall(users.admin, 'draw-roster', 'csv', { search: `?draw=${otherDrawId}` })
					)
				).status
			).toBe(404);
		});

		it('every export of the main campaign excludes the other campaign’s data', async () => {
			for (const key of [
				'payments-by-date',
				'settlements-by-collector',
				'collector-accounts',
				'bonds-by-collector'
			]) {
				const csv = await csvOf(users.admin, key);
				const flat = csv.rows.flat().join('|');
				expect(flat, key).not.toContain('OtherCampaign');
				expect(flat, key).not.toContain('250.00');
			}
		});
	});

	describe('C8 dates are Buenos Aires dates', () => {
		it('today is the Buenos Aires calendar day, not the UTC one', () => {
			expect(todayInBuenosAires(new Date('2026-07-01T02:59:59Z'))).toBe('2026-06-30');
			expect(todayInBuenosAires(new Date('2026-07-01T03:00:00Z'))).toBe('2026-07-01');
			expect(todayInBuenosAires(new Date('2026-01-01T00:30:00Z'))).toBe('2025-12-31');
		});

		it('the export file name carries the Buenos Aires date even when UTC is already the next day', async () => {
			vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-07-01T02:30:00Z') });
			try {
				const response = await exportCall(users.admin, 'prizes', 'csv');
				expect(response.headers.get('content-disposition')).toBe(
					`attachment; filename="report-prizes-${campaignId.slice(0, 8)}-2026-06-30.csv"`
				);
			} finally {
				vi.useRealTimers();
			}
		});

		it('payments keep their own date and the ledger shows entries on the Buenos Aires day', async () => {
			const csv = await csvOf(users.admin, 'payments-by-date');
			expect(csv.rows.map((r) => r[0]).sort()).toEqual([CASH_DATE, today].sort());
			const ledger = await csvOf(users.admin, 'collector-ledger', {
				search: `?collector=${collectorId}`
			});
			const bsAs = (iso: string) =>
				new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(
					new Date(iso)
				);
			const { data, error } = await users.admin.client
				.from('collector_ledger_entries')
				.select('occurred_at')
				.eq('campaign_id', campaignId)
				.eq('collector_id', collectorId);
			if (error) throw error;
			const expectedDays = (data ?? []).map((r: any) => bsAs(r.occurred_at)).sort();
			expect(ledger.rows.map((r) => r[0]).sort()).toEqual(expectedDays);
			for (const row of ledger.rows) expect(row[1]).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
		});
	});
});

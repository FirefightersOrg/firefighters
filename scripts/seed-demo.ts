import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { resolveSeedConfig } from './seed-admin';

/**
 * Loads one realistic campaign into the LOCAL database, for UX work and manual testing: collectors,
 * buyers, bonds, deliveries, sales, payments, closed and open settlements, collector submissions
 * from the portal, a ledger adjustment and three draws (completed, roster generated, scheduled).
 *
 * Run after `pnpm db:reset` and `APP_ENV=local pnpm seed:admin`:
 *
 *   APP_ENV=local pnpm seed:demo
 *
 * Everything is written through the same audited SQL functions the app calls, signed in as the
 * seeded admin (and as the fixture collector for the portal submissions), so the data obeys every
 * rule. It refuses to run outside APP_ENV=local + a localhost Supabase, and it does nothing when
 * the demo campaign already exists. Numbers are deterministic (seeded generator): two runs on a
 * clean database give the same campaign.
 */

export const DEMO_CAMPAIGN_NAME = 'Bono Contribución 2026';
const BOND_VALUE = 60_000;
const INSTALLMENTS = 6;
const BOND_COUNT = 240;

const COLLECTORS = [
	{ name: 'Jorge Medina', phone: '2364 51-2203', linked: true },
	{ name: 'Marta Giménez', phone: '2364 40-1187', linked: false },
	{ name: 'Carlos Benítez', phone: '2364 55-9034', linked: false },
	{ name: 'Lucía Fernández', phone: '2364 47-6620', linked: false },
	{ name: 'Raúl Sosa', phone: '2364 42-7781', linked: false },
	{ name: 'Héctor Acosta', phone: '2364 58-3149', linked: false }
] as const;

const FIRST_NAMES = [
	'María',
	'Juan',
	'Ana',
	'José',
	'Silvia',
	'Luis',
	'Norma',
	'Daniel',
	'Graciela',
	'Miguel',
	'Susana',
	'Roberto',
	'Claudia',
	'Oscar',
	'Patricia',
	'Ricardo',
	'Mónica',
	'Eduardo',
	'Liliana',
	'Sergio',
	'Verónica',
	'Pablo',
	'Stella',
	'Néstor'
];
const LAST_NAMES = [
	'González',
	'Rodríguez',
	'Gómez',
	'Fernández',
	'López',
	'Díaz',
	'Martínez',
	'Pérez',
	'Romero',
	'Sánchez',
	'Álvarez',
	'Torres',
	'Ruiz',
	'Ramírez',
	'Flores',
	'Acuña',
	'Ibáñez',
	'Ojeda',
	'Villalba',
	'Cabrera',
	'Luna',
	'Peralta',
	'Núñez',
	'Aguirre'
];
const STREETS = [
	'Rivadavia',
	'Belgrano',
	'San Martín',
	'Mitre',
	'Sarmiento',
	'Alem',
	'Moreno',
	'Urquiza',
	'9 de Julio',
	'25 de Mayo'
];
const BUSINESSES = [
	'Ferretería El Tornillo',
	'Panadería La Espiga',
	'Corralón Don Pedro',
	'Farmacia Central',
	'Agroveterinaria El Ceibo'
];

/** Deterministic generator (mulberry32), so the demo data does not change between runs. */
function generator(seed: number) {
	let state = seed;
	return () => {
		state |= 0;
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const random = generator(2026);
const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)];
const between = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));

/** Calendar day in Buenos Aires, offset by `days`, as YYYY-MM-DD. */
function baDay(days = 0) {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: 'America/Argentina/Buenos_Aires'
	}).format(new Date(Date.now() + days * 86_400_000));
}

const options = { auth: { autoRefreshToken: false, persistSession: false } };
let requestCounter = 0;
const requestId = (label: string) => `seed-demo-${label}-${(requestCounter += 1)}`;

async function signIn(url: string, anonKey: string, email: string, password: string) {
	const auth = createClient(url, anonKey, options);
	const { data, error } = await auth.auth.signInWithPassword({ email, password });
	if (error || !data.session) throw new Error(`Could not sign in ${email}: ${error?.message}`);
	return createClient(url, anonKey, {
		...options,
		global: { headers: { Authorization: `Bearer ${data.session.access_token}` } }
	});
}

async function call<T = string>(
	client: SupabaseClient,
	name: string,
	args: Record<string, unknown>
): Promise<T> {
	const { data, error } = await client.rpc(name, args);
	if (error) throw new Error(`${name}: ${error.message}`);
	return data as T;
}

interface Installment {
	id: string;
	installment_number: number;
	amount: number;
	due_date: string;
}
interface Sale {
	id: string;
	collectorId: string;
	soldDaysAgo: number;
	pending: Installment[];
}

/**
 * Seeds the demo campaign. Safe to call again: it does nothing when the campaign already exists.
 * Exported for the realistic-data E2E sweep, which needs the campaign before it starts.
 */
export async function seedDemo(): Promise<void> {
	const envPath = resolve(process.cwd(), '.env');
	if (existsSync(envPath)) process.loadEnvFile(envPath);
	const config = resolveSeedConfig();
	if (config.appEnv !== 'local')
		throw new Error('seed-demo only runs with APP_ENV=local against a local Supabase.');
	const anonKey = process.env.PUBLIC_SUPABASE_ANON_KEY?.trim();
	if (!anonKey || !config.serviceRoleKey)
		throw new Error('PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required.');

	const service = createClient(config.supabaseUrl, config.serviceRoleKey, options);
	const admin = await signIn(
		config.supabaseUrl,
		anonKey,
		config.admin.email,
		config.admin.password
	);

	const existing = await service.from('campaigns').select('id').eq('name', DEMO_CAMPAIGN_NAME);
	if (existing.error) throw new Error(existing.error.message);
	if (existing.data.length > 0) {
		console.log(`"${DEMO_CAMPAIGN_NAME}" already exists (${existing.data[0].id}). Nothing to do.`);
		return;
	}

	// Campaigns: the working one (active), plus a draft so the campaign list is not a single row.
	const campaignArgs = {
		p_simple_bond_value: BOND_VALUE.toFixed(2),
		p_installment_count: INSTALLMENTS,
		p_number_digits: 4,
		p_max_number: 9999,
		p_associated_number_offset: 5000,
		p_overflow_policy: 'reject',
		p_barcode_mode: 'base_number'
	};
	const campaignId = await call(admin, 'campaign_create', {
		...campaignArgs,
		p_name: DEMO_CAMPAIGN_NAME,
		p_starts_at: `${baDay(-150)}T03:00:00Z`,
		p_ends_at: `${baDay(215)}T03:00:00Z`,
		p_request_id: requestId('campaign')
	});
	await call(admin, 'campaign_create', {
		...campaignArgs,
		p_name: 'Bono Contribución 2027',
		p_simple_bond_value: '84000.00',
		p_starts_at: `${baDay(220)}T03:00:00Z`,
		p_ends_at: `${baDay(585)}T03:00:00Z`,
		p_request_id: requestId('campaign-draft')
	});
	console.log(`Campaign ${campaignId}`);

	// Commission rules (set while the campaign is a draft, like the checklist asks).
	for (const [ruleType, percentage] of [
		['cash_full_payment', '10.00'],
		['installment_first', '20.00'],
		['installment_middle', '10.00'],
		['installment_last', '10.00']
	] as const) {
		await call(admin, 'commission_rule_create', {
			p_campaign_id: campaignId,
			p_rule_type: ruleType,
			p_installment_number: null,
			p_percentage: percentage,
			p_fixed_amount: null,
			p_valid_from: baDay(-150),
			p_valid_to: null,
			p_request_id: requestId('rule'),
			p_reason: null
		});
	}
	await call(admin, 'campaign_transition', {
		p_id: campaignId,
		p_to_status: 'active',
		p_request_id: requestId('activate')
	});

	// Collectors. The first one is linked to the fixture collector user, so the portal has data.
	const fixture = config.fixtures.find((user) => user.roleNames.includes('collector'));
	if (!fixture) throw new Error('The fixture collector user is missing; run seed:admin first.');
	const profile = await service.from('profiles').select('id').eq('email', fixture.email).single();
	if (profile.error) throw new Error(`Collector profile: ${profile.error.message}`);
	const collectorIds: string[] = [];
	for (const collector of COLLECTORS) {
		let existing: string | null = null;
		if (collector.linked) {
			const linked = await service
				.from('collectors')
				.select('id')
				.eq('user_profile_id', profile.data.id)
				.maybeSingle();
			if (linked.error) throw new Error(linked.error.message);
			existing = linked.data?.id ?? null;
		}
		const created = () =>
			call(admin, 'collector_create', {
				p_display_name: collector.name,
				p_phone: collector.phone,
				p_address: `${pick(STREETS)} ${between(100, 1900)}`,
				p_user_profile_id: collector.linked ? profile.data.id : null,
				p_request_id: requestId('collector')
			});
		collectorIds.push(existing ?? (await created()));
	}

	// Buyers: people, plus a few local businesses.
	const buyerIds: string[] = [];
	for (let i = 0; i < 90; i += 1) {
		const business = i % 18 === 17;
		buyerIds.push(
			await call(admin, 'buyer_create', {
				p_type: business ? 'business' : 'individual',
				p_first_name: business ? null : pick(FIRST_NAMES),
				p_last_name: business ? null : pick(LAST_NAMES),
				p_business_name: business ? `${BUSINESSES[(i / 18) | 0]} ${i}` : null,
				p_document_number: business ? null : String(between(12_000_000, 44_000_000)),
				p_tax_id: business ? `30${between(500_000_000, 719_999_999)}` : null,
				p_phone: `2364 ${between(40, 59)}-${between(1000, 9999)}`,
				p_address: `${pick(STREETS)} ${between(100, 1900)}${i % 3 === 0 ? ', entre avenida de los Inmigrantes y camino General San Martín, barrio Los Aromos, casa del fondo' : ''}`,
				p_usual_collector_id: collectorIds[i % collectorIds.length],
				p_request_id: requestId('buyer')
			})
		);
	}

	// Bonds 0001..0240, one base number each (the associated number is base + 5000).
	const bondIds: string[] = [];
	for (let base = 1; base <= BOND_COUNT; base += 1) {
		bondIds.push(
			await call(admin, 'bond_create', {
				p_campaign_id: campaignId,
				p_base_numbers: [base],
				p_request_id: requestId('bond')
			})
		);
	}
	console.log(
		`${bondIds.length} bonds, ${buyerIds.length} buyers, ${collectorIds.length} collectors`
	);

	// Deliveries: 35 bonds per collector in two notes; the last 30 bonds stay available.
	const held = new Map<string, string[]>();
	for (const [index, collectorId] of collectorIds.entries()) {
		const bonds = bondIds.slice(index * 35, index * 35 + 35);
		held.set(collectorId, bonds);
		for (const part of [bonds.slice(0, 20), bonds.slice(20)]) {
			await call(admin, 'bond_deliver', {
				p_campaign_id: campaignId,
				p_collector_id: collectorId,
				p_bond_ids: part,
				p_notes: null,
				p_request_id: requestId('delivery')
			});
		}
	}

	// Sales: about two thirds of what each collector holds, sold over the last four months.
	const sales: Sale[] = [];
	let buyerCursor = 0;
	for (const collectorId of collectorIds) {
		const bonds = held.get(collectorId)!;
		const sellCount = between(20, 27);
		for (const bondId of bonds.slice(0, sellCount)) {
			const soldDaysAgo = between(4, 135);
			const fullPayment = random() < 0.25;
			const saleId = await call(admin, 'sale_register', {
				p_campaign_id: campaignId,
				p_bond_id: bondId,
				p_buyer_id: buyerIds[buyerCursor % buyerIds.length],
				p_payment_mode: fullPayment ? 'full_payment' : 'installments',
				p_first_due_date: fullPayment ? null : baDay(-soldDaysAgo + between(0, 10)),
				p_sale_date: baDay(-soldDaysAgo),
				p_request_id: requestId('sale')
			});
			buyerCursor += between(1, 2);
			const plan = await service.from('payment_plans').select('id').eq('sale_id', saleId).single();
			if (plan.error) throw new Error(plan.error.message);
			const installments = await service
				.from('installments')
				.select('id, installment_number, amount, due_date')
				.eq('payment_plan_id', plan.data.id)
				.order('installment_number');
			if (installments.error) throw new Error(installments.error.message);
			sales.push({
				id: saleId,
				collectorId,
				soldDaysAgo,
				pending: installments.data.map((row) => ({ ...row, amount: Number(row.amount) }))
			});
		}
	}
	console.log(`${sales.length} sales`);

	/** Pays the next pending installment of `sale` inside `settlementId`. */
	async function pay(settlementId: string, sale: Sale, daysAgo: number) {
		const installment = sale.pending.shift();
		if (!installment) return;
		await call(admin, 'settlement_add_payment', {
			p_settlement_id: settlementId,
			p_sale_id: sale.id,
			p_amount: installment.amount.toFixed(2),
			p_payment_method: random() < 0.7 ? 'cash' : 'transfer',
			p_applications: [
				{ installment_id: installment.id, amount_applied: installment.amount.toFixed(2) }
			],
			p_payment_date: baDay(-Math.max(0, Math.min(daysAgo, sale.soldDaysAgo))),
			p_request_id: requestId('payment')
		});
	}

	// Settlements: two closed rounds per collector, then an open one for the first three.
	const settlementIds = new Map<string, string[]>();
	for (const [index, collectorId] of collectorIds.entries()) {
		const own = sales.filter((sale) => sale.collectorId === collectorId);
		settlementIds.set(collectorId, []);
		for (const round of [0, 1, 2]) {
			if (round === 2 && index > 2) break;
			const settlementId = await call(admin, 'settlement_open', {
				p_campaign_id: campaignId,
				p_collector_id: collectorId,
				p_notes: null,
				p_request_id: requestId('settlement')
			});
			settlementIds.get(collectorId)!.push(settlementId);
			const payers = own.filter(
				(sale) => sale.pending.length > 0 && random() < (round === 2 ? 0.3 : 0.75)
			);
			for (const sale of payers) {
				const daysAgo = round === 0 ? between(45, 90) : round === 1 ? between(8, 40) : 1;
				await pay(settlementId, sale, daysAgo);
				// Some buyers pay two installments together.
				if (round < 2 && random() < 0.35) await pay(settlementId, sale, daysAgo);
			}
			if (round < 2)
				await call(admin, 'settlement_close', {
					p_settlement_id: settlementId,
					p_request_id: requestId('close')
				});
		}
	}
	console.log('Settlements closed and opened');

	// Portal: the linked collector sends two payments; one stays unprocessed, one is attached to the
	// open settlement. Skipped (with a note) if the collector has nothing left to collect.
	const collectorClient = await signIn(
		config.supabaseUrl,
		anonKey,
		fixture.email,
		fixture.password
	);
	const ownPending = sales.filter(
		(sale) => sale.collectorId === collectorIds[0] && sale.pending.length > 0
	);
	const submitted: string[] = [];
	for (const sale of ownPending.slice(0, 2)) {
		const installment = sale.pending.shift()!;
		submitted.push(
			await call(collectorClient, 'portal_payment_submit', {
				p_sale_id: sale.id,
				p_amount: installment.amount.toFixed(2),
				p_payment_method: 'cash',
				p_applications: [
					{ installment_id: installment.id, amount_applied: installment.amount.toFixed(2) }
				],
				p_payment_date: baDay(0),
				p_request_id: requestId('portal-payment'),
				p_note: 'Cobrado en el domicilio'
			})
		);
	}
	const openSettlement = settlementIds.get(collectorIds[0])?.[2];
	if (submitted[1] && openSettlement)
		await call(admin, 'settlement_attach_collector_payment', {
			p_settlement_id: openSettlement,
			p_payment_id: submitted[1],
			p_request_id: requestId('attach')
		});

	// A manual ledger adjustment, a returned bond and a lost one.
	await call(admin, 'collector_ledger_adjust', {
		p_campaign_id: campaignId,
		p_collector_id: collectorIds[1],
		p_amount: '2500.00',
		p_direction: 'collector_debit',
		p_reason: 'Adelanto de comisión entregado en efectivo',
		p_request_id: requestId('ledger')
	});
	const spare = held.get(collectorIds[3])!;
	await call(admin, 'bond_return', {
		p_campaign_id: campaignId,
		p_bond_ids: spare.slice(-3),
		p_notes: 'Devueltos sin vender',
		p_request_id: requestId('return'),
		p_from_collector_id: collectorIds[3]
	});
	await call(admin, 'bond_mark_lost', {
		p_campaign_id: campaignId,
		p_bond_id: held.get(collectorIds[4])!.at(-1),
		p_responsible_party: COLLECTORS[4].name,
		p_lost_on: baDay(-20),
		p_reason: 'El talonario se mojó y no se puede leer',
		p_request_id: requestId('lost')
	});

	// Draws: one finished (a delivered prize and an unawarded one), one with its roster generated,
	// and the final one still scheduled.
	const finished = await call(admin, 'draw_create', {
		p_campaign_id: campaignId,
		p_draw_type: 'monthly',
		p_name: 'Sorteo de octubre',
		p_draw_date: baDay(0),
		p_payment_cutoff_at: `${baDay(-1)}T23:59:00-03:00`,
		p_required_installment_number: 1,
		p_eligibility_rule: {},
		p_request_id: requestId('draw')
	});
	await call(admin, 'draw_generate_roster', {
		p_draw_id: finished,
		p_request_id: requestId('roster')
	});
	await call(admin, 'draw_freeze_roster', {
		p_draw_id: finished,
		p_request_id: requestId('freeze')
	});
	const roster = await admin
		.from('draw_roster_entries')
		.select('number_value, eligible, draw_rosters!inner(draw_id)')
		.eq('draw_rosters.draw_id', finished)
		.eq('eligible', true)
		.limit(1);
	if (roster.error) throw new Error(`Roster: ${roster.error.message}`);
	const winningNumber = roster.data[0]?.number_value as number | undefined;
	const firstPrize = await call(admin, 'prize_create', {
		p_draw_id: finished,
		p_name: 'Televisor 50 pulgadas',
		p_description: 'Donado por Casa Peralta',
		p_position: 1,
		p_request_id: requestId('prize')
	});
	const secondPrize = await call(admin, 'prize_create', {
		p_draw_id: finished,
		p_name: 'Bicicleta rodado 29',
		p_description: null,
		p_position: 2,
		p_request_id: requestId('prize')
	});
	if (winningNumber !== undefined) {
		await call(admin, 'draw_load_winning_number', {
			p_prize_id: firstPrize,
			p_number_value: winningNumber,
			p_notes: null,
			p_request_id: requestId('winner')
		});
		await call(admin, 'prize_resolve', {
			p_prize_id: firstPrize,
			p_decision: 'award',
			p_notes: null,
			p_request_id: requestId('award')
		});
		await call(admin, 'prize_deliver', {
			p_prize_id: firstPrize,
			p_notes: 'Entregado en el cuartel',
			p_request_id: requestId('deliver')
		});
	}
	// 4990 was never loaded, so it is not in the roster: the prize is left unawarded.
	await call(admin, 'draw_load_winning_number', {
		p_prize_id: secondPrize,
		p_number_value: 4990,
		p_notes: null,
		p_request_id: requestId('winner')
	});

	const next = await call(admin, 'draw_create', {
		p_campaign_id: campaignId,
		p_draw_type: 'monthly',
		p_name: 'Sorteo de noviembre',
		p_draw_date: baDay(12),
		p_payment_cutoff_at: `${baDay(10)}T23:59:00-03:00`,
		p_required_installment_number: 2,
		p_eligibility_rule: {},
		p_request_id: requestId('draw')
	});
	await call(admin, 'draw_generate_roster', { p_draw_id: next, p_request_id: requestId('roster') });
	await call(admin, 'draw_create', {
		p_campaign_id: campaignId,
		p_draw_type: 'final',
		p_name: 'Sorteo final',
		p_draw_date: baDay(210),
		p_payment_cutoff_at: `${baDay(205)}T23:59:00-03:00`,
		p_required_installment_number: null,
		p_eligibility_rule: {},
		p_request_id: requestId('draw')
	});

	console.log(`Demo data ready: http://localhost:5173/campaigns/${campaignId}`);
}

function isCliEntry(): boolean {
	const entry = process.argv[1];
	return !!entry && import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isCliEntry()) {
	seedDemo()
		.then(() => process.exit(0))
		.catch((err) => {
			console.error('seed-demo failed:', err);
			process.exit(1);
		});
}

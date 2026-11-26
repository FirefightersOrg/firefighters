import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { DEMO_CAMPAIGN_NAME } from './seed-demo';

/**
 * The screens of the app, addressed with records of the demo campaign (`pnpm seed:demo`). Used by
 * the realistic-data E2E sweep (`tests/e2e/realistic-data.spec.ts`); the UX walkthrough also used
 * this list during the redesign and was removed in PR 20.
 */

export interface DemoIds {
	campaign: string;
	draft: string;
	soldBond: string;
	availableBond: string;
	lostBond: string;
	buyer: string;
	collector: string;
	linkedCollector: string;
	sale: string;
	portalSale: string;
	portalBond: string;
	portalBuyer: string;
	note: string;
	closedSettlement: string;
	openSettlement: string;
	payment: string;
	finishedDraw: string;
	rosterDraw: string;
	scheduledDraw: string;
	deliveredPrize: string;
	unawardedPrize: string;
}
export type Screen = { slug: string; path: string };

const options = { auth: { autoRefreshToken: false, persistSession: false } };

/** A `select('id')` query that can still take equality filters. */
interface IdQuery {
	eq(column: string, value: string): IdQuery;
	limit(count: number): PromiseLike<{
		data: { id: string }[] | null;
		error: { message: string } | null;
	}>;
}

/** The id of the first row of `table` that passes `filter`. Throws when there is none. */
async function one(
	client: SupabaseClient,
	table: string,
	filter: (query: IdQuery) => IdQuery
): Promise<string> {
	const query = client.from(table).select('id') as unknown as IdQuery;
	const { data, error } = await filter(query).limit(1);
	if (error || !data?.[0])
		throw new Error(`No ${table} row in the demo campaign: ${error?.message ?? 'not found'}`);
	return data[0].id;
}

/** Ids of one example of each kind of record in the demo campaign, read as the admin. */
export async function findDemoIds(admin: SupabaseClient): Promise<DemoIds> {
	const campaign = await one(admin, 'campaigns', (q) => q.eq('name', DEMO_CAMPAIGN_NAME));
	const draft = await one(admin, 'campaigns', (q) => q.eq('status', 'draft'));
	const inCampaign = (q: IdQuery) => q.eq('campaign_id', campaign);
	// The collector linked to a user, found through its open settlement in the demo campaign. Other
	// suites link collectors of their own, so «any linked collector» is not enough on a shared database.
	const linked = await admin
		.from('settlements')
		.select('id, collector_id, collectors!inner(user_profile_id)')
		.eq('campaign_id', campaign)
		.eq('status', 'open')
		.not('collectors.user_profile_id', 'is', null)
		.limit(1);
	if (linked.error || !linked.data?.[0])
		throw new Error(
			`No open settlement of a linked collector in the demo campaign: ${linked.error?.message ?? 'not found'}`
		);
	const linkedCollector = linked.data[0].collector_id as string;
	const openSettlement = linked.data[0].id as string;
	const closed = await admin
		.from('settlements')
		.select('id, collector_id')
		.eq('campaign_id', campaign)
		.eq('status', 'closed')
		.neq('collector_id', linkedCollector)
		.order('total_amount', { ascending: false })
		.limit(1);
	const closedSettlement = closed.data![0].id as string;
	const collector = closed.data![0].collector_id as string;
	const payment = await one(admin, 'payments', (q) => q.eq('settlement_id', closedSettlement));
	const sale = await admin
		.from('payments')
		.select('sale_id, sales!inner(bond_id, buyer_id, payment_mode)')
		.eq('settlement_id', closedSettlement)
		.eq('sales.payment_mode', 'installments')
		.limit(1);
	const saleRow = sale.data![0] as unknown as {
		sale_id: string;
		sales: { bond_id: string; buyer_id: string };
	};
	const portal = await admin
		.from('sales')
		.select('id, bond_id, buyer_id')
		.eq('campaign_id', campaign)
		.eq('collector_id', linkedCollector)
		.eq('payment_mode', 'installments')
		.limit(1);
	const finishedDraw = await one(admin, 'draws', (q) =>
		inCampaign(q).eq('status', 'roster_frozen')
	);
	const prizes = await admin
		.from('prizes')
		.select('id, status')
		.eq('draw_id', finishedDraw)
		.order('position');
	return {
		campaign,
		draft,
		soldBond: saleRow.sales.bond_id,
		availableBond: await one(admin, 'bonds', (q) =>
			inCampaign(q).eq('commercial_status', 'available')
		),
		lostBond: await one(admin, 'bonds', (q) => inCampaign(q).eq('commercial_status', 'lost')),
		buyer: saleRow.sales.buyer_id,
		collector,
		linkedCollector,
		sale: saleRow.sale_id,
		portalSale: portal.data![0].id,
		portalBond: portal.data![0].bond_id,
		portalBuyer: portal.data![0].buyer_id,
		note: await one(admin, 'delivery_notes', (q) => inCampaign(q).eq('collector_id', collector)),
		closedSettlement,
		openSettlement,
		payment,
		finishedDraw,
		rosterDraw: await one(admin, 'draws', (q) => inCampaign(q).eq('status', 'roster_generated')),
		scheduledDraw: await one(admin, 'draws', (q) => inCampaign(q).eq('status', 'scheduled')),
		deliveredPrize: prizes.data![0].id,
		unawardedPrize: prizes.data![1].id
	};
}

/** Every staff screen, with one example of each state the demo campaign has. */
export function staffScreens(i: DemoIds): Screen[] {
	const c = `/campaigns/${i.campaign}`;
	const s = (slug: string, path: string): Screen => ({ slug, path });
	return [
		s('00-home', '/'),
		s('01-campaigns-list', '/campaigns'),
		s('02-campaign-new', '/campaigns/new'),
		s('03-campaign-workbench', c),
		s('04-campaign-draft', `/campaigns/${i.draft}`),
		s('05-campaign-data-and-rules', `${c}/configuracion`),
		s('10-bonds-list', `${c}/bonds`),
		s('11-bonds-search-result', `${c}/bonds?base=12`),
		s('12-bonds-search-empty', `${c}/bonds?base=4321`),
		s('13-bond-sold', `${c}/bonds/${i.soldBond}`),
		s('14-bond-available', `${c}/bonds/${i.availableBond}`),
		s('15-bond-lost', `${c}/bonds/${i.lostBond}`),
		s('16-bond-new', `${c}/bonds/new`),
		s('17-pata-new', `${c}/bonds/pata/new`),
		s('18-bonds-scan', `${c}/bonds/scan`),
		s('19-bonds-import', `${c}/bonds/import`),
		s('20-deliveries-list', `${c}/deliveries`),
		s('21-delivery-new', `${c}/deliveries/new`),
		s('22-delivery-note', `${c}/deliveries/${i.note}`),
		s('23-delivery-note-print', `${c}/deliveries/${i.note}/print`),
		s('30-sales-list', `${c}/sales`),
		s('31-sale-new', `${c}/sales/new`),
		s('32-sale-detail', `${c}/sales/${i.sale}`),
		s('40-settlements-list', `${c}/settlements`),
		s('41-settlement-new', `${c}/settlements/new`),
		s('42-settlement-open', `${c}/settlements/${i.openSettlement}`),
		s('43-settlement-closed', `${c}/settlements/${i.closedSettlement}`),
		s('44-settlement-print', `${c}/settlements/${i.closedSettlement}/print`),
		s('45-payment-print', `${c}/payments/${i.payment}/print`),
		s('50-collectors-list', `${c}/collectors`),
		s('51-collector-new', `${c}/collectors/new`),
		s('52-collector-detail', `${c}/collectors/${i.collector}`),
		s('53-collector-ledger', `${c}/collectors/${i.collector}/ledger`),
		s('54-commissions', `${c}/commissions`),
		s('60-buyers-list', `${c}/buyers`),
		s('61-buyer-new', `${c}/buyers/new`),
		s('62-buyer-detail', `${c}/buyers/${i.buyer}`),
		s('70-draws-list', `${c}/draws`),
		s('71-draw-new', `${c}/draws/new`),
		s('72-draw-scheduled', `${c}/draws/${i.scheduledDraw}`),
		s('73-draw-roster-generated', `${c}/draws/${i.rosterDraw}`),
		s('74-draw-roster-frozen', `${c}/draws/${i.finishedDraw}`),
		s('75-draw-roster', `${c}/draws/${i.finishedDraw}/roster`),
		s('76-draw-winners', `${c}/draws/${i.finishedDraw}/winners`),
		s(
			'77-prize-delivery-certificate',
			`${c}/draws/${i.finishedDraw}/winners/${i.deliveredPrize}/delivery-certificate`
		),
		s(
			'78-prize-unawarded-certificate',
			`${c}/draws/${i.finishedDraw}/winners/${i.unawardedPrize}/unawarded-certificate`
		),
		s('80-reports-operational', `${c}/reports`),
		s('81-reports-financial', `${c}/reports/financial`),
		s(
			'82-reports-financial-collector',
			`${c}/reports/financial?collector=${i.collector}&draw=${i.finishedDraw}`
		),
		s('90-audit', `${c}/audit`),
		s('91-backups', `${c}/backups`),
		s('98-not-found', `${c}/bonds/00000000-0000-4000-8000-000000000000`)
	];
}

/** Every screen of the collector portal. */
export function portalScreens(i: DemoIds): Screen[] {
	const p = `/portal/${i.campaign}`;
	const s = (slug: string, path: string): Screen => ({ slug, path });
	return [
		s('p0-portal-home', '/portal'),
		s('p1-my-bonds', `${p}/bonos`),
		s('p2-my-bond', `${p}/bonos/${i.portalBond}`),
		s('p3-my-sales', `${p}/ventas`),
		s('p4-my-sale', `${p}/ventas/${i.portalSale}`),
		s('p5-my-buyers', `${p}/compradores`),
		s('p6-my-buyer', `${p}/compradores/${i.portalBuyer}`),
		s('p7-to-collect', `${p}/por-cobrar`),
		s('p8-my-account', `${p}/cuenta`)
	];
}

/** A Supabase client signed in as `user` (RLS applies as it does in the app). */
export async function signedInClient(
	supabaseUrl: string,
	anonKey: string,
	user: { email: string; password: string }
): Promise<SupabaseClient> {
	const auth = createClient(supabaseUrl, anonKey, options);
	const session = await auth.auth.signInWithPassword(user);
	if (session.error || !session.data.session)
		throw new Error(`Could not sign in ${user.email}: ${session.error?.message}`);
	return createClient(supabaseUrl, anonKey, {
		...options,
		global: { headers: { Authorization: `Bearer ${session.data.session.access_token}` } }
	});
}

import { describe, expect, it } from 'vitest';
import {
	CAMPAIGN_SECTIONS,
	CAMPAIGN_TAB_COUNT,
	campaignNav,
	mainNavItems,
	type CampaignSectionKey
} from './navigation';

const ID = 'f0000000-0000-0000-0000-000000000001';
const HOME = `/campaigns/${ID}`;

/**
 * What each seeded role holds (the permissions that decide navigation), as granted by the
 * migrations on 2026-11-26. They are fixtures for the rules below, not a copy of the database.
 */
const ROLES: Record<string, string[]> = {
	admin: [
		'audit.view',
		'bond.assign',
		'bond.create',
		'bond.view',
		'bond.view_own',
		'buyer.manage',
		'buyer.view',
		'campaign.view',
		'collector.manage',
		'collector.view',
		'commission.view',
		'draw.create',
		'draw.view',
		'report.export',
		'report.view_financial',
		'report.view_operational',
		'sale.create',
		'sale.view',
		'settlement.close',
		'settlement.create',
		'settlement.view'
	],
	operator: [
		'bond.assign',
		'bond.create',
		'bond.view',
		'buyer.manage',
		'buyer.view',
		'campaign.view',
		'collector.view',
		'draw.load_winner',
		'draw.view',
		'payment.create',
		'report.export',
		'report.view_operational',
		'sale.create',
		'sale.view',
		'settlement.create',
		'settlement.update_open',
		'settlement.view'
	],
	treasurer: [
		'audit.view',
		'bond.view',
		'buyer.view',
		'campaign.view',
		'collector.ledger.view',
		'collector.view',
		'commission.view',
		'draw.freeze_roster',
		'draw.load_winner',
		'draw.view',
		'payment.create',
		'report.export',
		'report.view_financial',
		'report.view_operational',
		'sale.view',
		'settlement.close',
		'settlement.create',
		'settlement.view'
	],
	'read-only': [
		'bond.view',
		'buyer.view',
		'campaign.view',
		'collector.view',
		'commission.view',
		'report.export',
		'report.view_financial',
		'report.view_operational'
	],
	collector: [
		'bond.view_own',
		'campaign.view',
		'collector.ledger.view_own',
		'payment.create_own',
		'sale.view_own'
	]
};

const keys = (role: string, pathname = HOME) =>
	campaignNav(ROLES[role], ID, pathname)
		.groups.flatMap((group) => group.items)
		.map((item) => item.key);
const tabs = (role: string) => campaignNav(ROLES[role], ID, HOME).tabs.map((item) => item.key);

describe('campaignNav: sections by role', () => {
	const ALL = CAMPAIGN_SECTIONS.map((section) => section.key);

	it.each<[string, CampaignSectionKey[]]>([
		['admin', []],
		['operator', ['commissions', 'audit']],
		['treasurer', []],
		['read-only', ['settlements', 'draws', 'audit']],
		[
			'collector',
			[
				'bonds',
				'deliveries',
				'sales',
				'settlements',
				'collectors',
				'buyers',
				'draws',
				'reports',
				'commissions',
				'audit',
				'backups'
			]
		]
	])('%s sees every section except %j', (role, hidden) => {
		expect(keys(role)).toEqual(ALL.filter((key) => !hidden.includes(key)));
	});

	it('shows Inicio and Datos y reglas to anyone who can open the campaign', () => {
		expect(keys('collector')).toEqual(['home', 'rules']);
		const none = campaignNav([], ID, HOME).groups.flatMap((group) => group.items);
		expect(none.map((item) => item.key)).toEqual(['home', 'rules']);
	});

	it.each<[CampaignSectionKey, string[]]>([
		['bonds', ['bond.view']],
		['deliveries', ['bond.view', 'bond.assign']],
		['sales', ['sale.view', 'sale.create', 'bond.view']],
		[
			'settlements',
			[
				'settlement.view',
				'settlement.create',
				'settlement.update_open',
				'settlement.close',
				'settlement.correct'
			]
		],
		['collectors', ['collector.view', 'collector.manage']],
		['buyers', ['buyer.view', 'buyer.manage']],
		[
			'draws',
			[
				'draw.view',
				'draw.create',
				'draw.update',
				'draw.generate_roster',
				'draw.freeze_roster',
				'draw.load_winner'
			]
		],
		['reports', ['report.view_operational']],
		['commissions', ['commission.view']],
		['audit', ['audit.view']],
		['backups', ['report.export']]
	])('%s is shown by any one of its permissions, and by no other', (key, permissions) => {
		for (const permission of permissions)
			expect(
				campaignNav([permission], ID, HOME)
					.groups.flatMap((group) => group.items)
					.map((item) => item.key)
			).toContain(key);
		const others = [...new Set(Object.values(ROLES).flat())].filter(
			(code) => !CAMPAIGN_SECTIONS.find((section) => section.key === key)!.anyOf.includes(code)
		);
		// A section that shares no permission with the rest stays hidden when only the rest is held.
		const withOthers = campaignNav(others, ID, HOME)
			.groups.flatMap((group) => group.items)
			.map((item) => item.key);
		expect(withOthers).not.toContain(key);
	});

	it('groups the sections in order, with Administración last', () => {
		const nav = campaignNav(ROLES.admin, ID, HOME);
		expect(nav.groups.map((group) => group.title)).toEqual([
			null,
			'Operación',
			'Personas',
			'Sorteos y reportes',
			'Administración'
		]);
		expect(nav.groups.at(-1)!.items.map((item) => item.label)).toEqual([
			'Datos y reglas',
			'Reglas de comisión',
			'Registro de auditoría',
			'Copias de seguridad'
		]);
	});

	it('leaves out a group with no visible section', () => {
		expect(campaignNav(ROLES.collector, ID, HOME).groups.map((group) => group.group)).toEqual([
			'home',
			'admin'
		]);
	});

	it('builds each path inside the campaign', () => {
		const paths = campaignNav(ROLES.admin, ID, HOME)
			.groups.flatMap((group) => group.items)
			.map((item) => item.path);
		expect(paths[0]).toBe(HOME);
		expect(paths).toContain(`${HOME}/settlements`);
		expect(paths).toContain(`${HOME}/configuracion`);
		for (const path of paths) expect(path).not.toContain('[id]');
	});
});

describe('campaignNav: tabs and «Más»', () => {
	it('gives the daily work the four tabs', () => {
		for (const role of ['admin', 'operator', 'treasurer'])
			expect(tabs(role)).toEqual(['home', 'bonds', 'sales', 'settlements']);
	});

	it('fills a missing tab with the next section the role can see', () => {
		expect(tabs('read-only')).toEqual(['home', 'bonds', 'sales', 'deliveries']);
		expect(tabs('collector')).toEqual(['home']);
	});

	it('never has more tabs than fit, and never gives Administración a tab', () => {
		for (const role of Object.keys(ROLES)) {
			const nav = campaignNav(ROLES[role], ID, HOME);
			expect(nav.tabs.length).toBeLessThanOrEqual(CAMPAIGN_TAB_COUNT);
			expect(nav.tabs.every((item) => item.group !== 'admin')).toBe(true);
		}
	});

	it('puts every other visible section under «Más», grouped, exactly once', () => {
		for (const role of Object.keys(ROLES)) {
			const nav = campaignNav(ROLES[role], ID, HOME);
			const more = nav.more.flatMap((group) => group.items).map((item) => item.key);
			const all = nav.groups.flatMap((group) => group.items).map((item) => item.key);
			expect([...nav.tabs.map((item) => item.key), ...more].sort()).toEqual([...all].sort());
		}
		expect(campaignNav(ROLES.admin, ID, HOME).more.map((group) => group.title)).toEqual([
			'Operación',
			'Personas',
			'Sorteos y reportes',
			'Administración'
		]);
	});
});

describe('campaignNav: the current section', () => {
	const current = (pathname: string) => campaignNav(ROLES.admin, ID, pathname).current?.key;

	it('is Inicio only on the campaign page itself', () => {
		expect(current(HOME)).toBe('home');
		expect(current(`${HOME}/`)).toBe('home');
		expect(current(`${HOME}/bonds`)).toBe('bonds');
	});

	it('covers every page under a section', () => {
		expect(current(`${HOME}/bonds/0b0b0b0b-0000-4000-8000-000000000000`)).toBe('bonds');
		expect(current(`${HOME}/bonds/pata/new`)).toBe('bonds');
		expect(current(`${HOME}/settlements/new`)).toBe('settlements');
		expect(current(`${HOME}/collectors/abc/ledger`)).toBe('collectors');
		expect(current(`${HOME}/draws/abc/winners`)).toBe('draws');
		expect(current(`${HOME}/reports/financial`)).toBe('reports');
		expect(current(`${HOME}/configuracion`)).toBe('rules');
	});

	it('marks exactly one section, or none on a page that belongs to no section', () => {
		for (const pathname of [HOME, `${HOME}/bonds`, `${HOME}/sales/new`, `${HOME}/audit`]) {
			const items = campaignNav(ROLES.admin, ID, pathname).groups.flatMap((group) => group.items);
			expect(items.filter((item) => item.current)).toHaveLength(1);
		}
		expect(current(`${HOME}/payments/abc/print`)).toBeUndefined();
		// A section whose name starts like another is not confused with it.
		expect(current(`${HOME}/bondsextra`)).toBeUndefined();
	});

	it('is null for a section the person cannot see', () => {
		expect(campaignNav(ROLES.collector, ID, `${HOME}/bonds`).current).toBeNull();
	});
});

describe('mainNavItems', () => {
	it('still lists the top-level entries by permission', () => {
		expect(mainNavItems(['campaign.view'], '/campaigns').map((item) => item.label)).toEqual([
			'Campañas'
		]);
		expect(
			mainNavItems(['campaign.view', 'bond.view_own'], '/portal/x').find((item) => item.current)
				?.label
		).toBe('Mi portal');
	});
});

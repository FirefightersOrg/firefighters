/** Main navigation of the signed-in app shell: entries depend on the person's permissions. */
export type MainNavPath = '/campaigns' | '/portal';

export interface MainNavItem {
	label: string;
	path: MainNavPath;
	/** Permission required to see the entry. */
	permission: string;
}

export const MAIN_NAV: readonly MainNavItem[] = [
	{ label: 'Campañas', path: '/campaigns', permission: 'campaign.view' },
	{ label: 'Mi portal', path: '/portal', permission: 'bond.view_own' }
];

/** Entries the holder of `permissions` may see; `current` marks the section of `pathname`. */
export function mainNavItems(
	permissions: readonly string[],
	pathname: string
): { label: string; path: MainNavPath; current: boolean }[] {
	return MAIN_NAV.filter((item) => permissions.includes(item.permission)).map((item) => ({
		label: item.label,
		path: item.path,
		current: pathname === item.path || pathname.startsWith(`${item.path}/`)
	}));
}

/**
 * Sections of a campaign: the rail (desktop) and the tab bar (phone) of the campaign shell are built
 * from this list. Which ones a person sees depends on their permissions, with the same rules the
 * campaign page used for its section links (the pages check again on the server).
 */
export type CampaignSectionRoute =
	| '/campaigns/[id]'
	| '/campaigns/[id]/bonds'
	| '/campaigns/[id]/deliveries'
	| '/campaigns/[id]/sales'
	| '/campaigns/[id]/settlements'
	| '/campaigns/[id]/collectors'
	| '/campaigns/[id]/buyers'
	| '/campaigns/[id]/draws'
	| '/campaigns/[id]/reports'
	| '/campaigns/[id]/configuracion'
	| '/campaigns/[id]/commissions'
	| '/campaigns/[id]/audit'
	| '/campaigns/[id]/backups';

export type CampaignSectionKey =
	| 'home'
	| 'bonds'
	| 'deliveries'
	| 'sales'
	| 'settlements'
	| 'collectors'
	| 'buyers'
	| 'draws'
	| 'reports'
	| 'rules'
	| 'commissions'
	| 'audit'
	| 'backups';

export type CampaignSectionGroup = 'home' | 'operation' | 'people' | 'draws' | 'admin';

export interface CampaignSection {
	key: CampaignSectionKey;
	label: string;
	/** Shorter label for the tab bar, when the full one does not fit a fifth of a phone screen. */
	tabLabel?: string;
	route: CampaignSectionRoute;
	group: CampaignSectionGroup;
	/** Any of these permissions shows the section. Empty: everyone who can open the campaign. */
	anyOf: readonly string[];
}

export const CAMPAIGN_GROUP_TITLES: Record<CampaignSectionGroup, string | null> = {
	home: null,
	operation: 'Operación',
	people: 'Personas',
	draws: 'Sorteos y reportes',
	admin: 'Administración'
};

export const CAMPAIGN_SECTIONS: readonly CampaignSection[] = [
	{ key: 'home', label: 'Inicio', route: '/campaigns/[id]', group: 'home', anyOf: [] },
	{
		key: 'bonds',
		label: 'Bonos',
		route: '/campaigns/[id]/bonds',
		group: 'operation',
		anyOf: ['bond.view']
	},
	{
		key: 'deliveries',
		label: 'Entregas',
		route: '/campaigns/[id]/deliveries',
		group: 'operation',
		anyOf: ['bond.view', 'bond.assign']
	},
	{
		key: 'sales',
		label: 'Ventas',
		route: '/campaigns/[id]/sales',
		group: 'operation',
		anyOf: ['sale.view', 'sale.create', 'bond.view']
	},
	{
		key: 'settlements',
		label: 'Rendiciones',
		route: '/campaigns/[id]/settlements',
		group: 'operation',
		anyOf: [
			'settlement.view',
			'settlement.create',
			'settlement.update_open',
			'settlement.close',
			'settlement.correct'
		]
	},
	{
		key: 'collectors',
		label: 'Cobradores',
		route: '/campaigns/[id]/collectors',
		group: 'people',
		anyOf: ['collector.view', 'collector.manage']
	},
	{
		key: 'buyers',
		label: 'Compradores',
		route: '/campaigns/[id]/buyers',
		group: 'people',
		anyOf: ['buyer.view', 'buyer.manage']
	},
	{
		key: 'draws',
		label: 'Sorteos',
		route: '/campaigns/[id]/draws',
		group: 'draws',
		anyOf: [
			'draw.view',
			'draw.create',
			'draw.update',
			'draw.generate_roster',
			'draw.freeze_roster',
			'draw.load_winner'
		]
	},
	{
		key: 'reports',
		label: 'Reportes',
		route: '/campaigns/[id]/reports',
		group: 'draws',
		anyOf: ['report.view_operational']
	},
	{
		key: 'rules',
		label: 'Datos y reglas',
		route: '/campaigns/[id]/configuracion',
		group: 'admin',
		anyOf: []
	},
	{
		key: 'commissions',
		label: 'Reglas de comisión',
		tabLabel: 'Comisiones',
		route: '/campaigns/[id]/commissions',
		group: 'admin',
		anyOf: ['commission.view']
	},
	{
		key: 'audit',
		label: 'Registro de auditoría',
		tabLabel: 'Auditoría',
		route: '/campaigns/[id]/audit',
		group: 'admin',
		anyOf: ['audit.view']
	},
	{
		key: 'backups',
		label: 'Copias de seguridad',
		tabLabel: 'Copias',
		route: '/campaigns/[id]/backups',
		group: 'admin',
		anyOf: ['report.export']
	}
];

/** The tab bar holds this many sections; the rest go under «Más». */
export const CAMPAIGN_TAB_COUNT = 4;

/**
 * Which sections get a tab, in order of preference: the first `CAMPAIGN_TAB_COUNT` the person can
 * see. The daily work first (find a bond, sales, settlements); a role without one of them gets the
 * next. Administración never takes a tab.
 */
export const CAMPAIGN_TAB_PRIORITY: readonly CampaignSectionKey[] = [
	'home',
	'bonds',
	'sales',
	'settlements',
	'deliveries',
	'draws',
	'reports',
	'collectors',
	'buyers'
];

export interface CampaignNavItem extends CampaignSection {
	/** Path of the section in this campaign (not resolved against the app's base path). */
	path: string;
	current: boolean;
}

export interface CampaignNav {
	/** Every visible section, grouped, in order: what the rail shows. */
	groups: { group: CampaignSectionGroup; title: string | null; items: CampaignNavItem[] }[];
	/** The first sections, for the tab bar. */
	tabs: CampaignNavItem[];
	/** The other visible sections, grouped: what «Más» opens. */
	more: { group: CampaignSectionGroup; title: string | null; items: CampaignNavItem[] }[];
	/** The section `pathname` is in, if any. */
	current: CampaignNavItem | null;
}

/**
 * The campaign's sections for the holder of `permissions`, with the one `pathname` is in marked
 * current. A section is current on its own page and on every page under it; «Inicio» only on the
 * campaign page itself.
 */
export function campaignNav(
	permissions: readonly string[],
	campaignId: string,
	pathname: string
): CampaignNav {
	const visible: CampaignNavItem[] = CAMPAIGN_SECTIONS.filter(
		(section) =>
			section.anyOf.length === 0 || section.anyOf.some((code) => permissions.includes(code))
	).map((section) => {
		const path = section.route.replace('[id]', campaignId);
		const current =
			section.key === 'home'
				? pathname === path || pathname === `${path}/`
				: pathname === path || pathname.startsWith(`${path}/`);
		return { ...section, path, current };
	});

	const grouped = (items: CampaignNavItem[]) =>
		(Object.keys(CAMPAIGN_GROUP_TITLES) as CampaignSectionGroup[])
			.map((group) => ({
				group,
				title: CAMPAIGN_GROUP_TITLES[group],
				items: items.filter((item) => item.group === group)
			}))
			.filter((entry) => entry.items.length > 0);

	const tabs = CAMPAIGN_TAB_PRIORITY.map((key) => visible.find((item) => item.key === key))
		.filter((item): item is CampaignNavItem => item !== undefined)
		.slice(0, CAMPAIGN_TAB_COUNT);
	const more = visible.filter((item) => !tabs.includes(item));
	return {
		groups: grouped(visible),
		tabs,
		more: grouped(more),
		current: visible.find((item) => item.current) ?? null
	};
}

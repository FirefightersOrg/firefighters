/** Sections of the collector portal inside a campaign: `/portal/[campaignId]/<section>`. */
export type PortalSection = 'bonos' | 'ventas' | 'compradores' | 'por-cobrar' | 'cuenta';

export interface PortalNavItem {
	section: PortalSection;
	label: string;
	/** The short word under the icon in the phone's tab bar. */
	tabLabel: string;
	/** Permission required to see the entry (the pages check it again on the server). */
	permission: string;
}

/**
 * In the order of the collector's day: what there is to collect first (decision P5), then the bonds
 * in hand, the sales, the buyers and the account.
 */
export const PORTAL_NAV: readonly PortalNavItem[] = [
	{
		section: 'por-cobrar',
		label: 'Por cobrar',
		tabLabel: 'Por cobrar',
		permission: 'sale.view_own'
	},
	{ section: 'bonos', label: 'Mis bonos', tabLabel: 'Bonos', permission: 'bond.view_own' },
	{ section: 'ventas', label: 'Mis ventas', tabLabel: 'Ventas', permission: 'sale.view_own' },
	{
		section: 'compradores',
		label: 'Mis compradores',
		tabLabel: 'Compradores',
		permission: 'sale.view_own'
	},
	{
		section: 'cuenta',
		label: 'Mi cuenta corriente',
		tabLabel: 'Cuenta',
		permission: 'collector.ledger.view_own'
	}
];

/** Entries the holder of `permissions` may see; `current` marks the section of `pathname`. */
export function portalNavItems(
	permissions: readonly string[],
	campaignId: string,
	pathname: string
): (PortalNavItem & { current: boolean })[] {
	return PORTAL_NAV.filter((item) => permissions.includes(item.permission)).map((item) => {
		const base = `/portal/${campaignId}/${item.section}`;
		return { ...item, current: pathname === base || pathname.startsWith(`${base}/`) };
	});
}

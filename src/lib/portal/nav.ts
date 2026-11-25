/** Sections of the collector portal inside a campaign: `/portal/[campaignId]/<section>`. */
export type PortalSection = 'bonos' | 'ventas' | 'compradores' | 'por-cobrar' | 'cuenta';

export interface PortalNavItem {
	section: PortalSection;
	label: string;
	/** Permission required to see the entry (the pages check it again on the server). */
	permission: string;
}

export const PORTAL_NAV: readonly PortalNavItem[] = [
	{ section: 'bonos', label: 'Mis bonos', permission: 'bond.view_own' },
	{ section: 'ventas', label: 'Mis ventas', permission: 'sale.view_own' },
	{ section: 'compradores', label: 'Mis compradores', permission: 'sale.view_own' },
	{ section: 'por-cobrar', label: 'Por cobrar', permission: 'sale.view_own' },
	{ section: 'cuenta', label: 'Mi cuenta corriente', permission: 'collector.ledger.view_own' }
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

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

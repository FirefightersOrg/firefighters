export const ICON_NAMES = [
	'check',
	'info',
	'alert',
	'error',
	'success',
	'x',
	'chevron-down',
	'plus',
	'search',
	'inbox',
	'download',
	'menu'
] as const;

export type IconName = (typeof ICON_NAMES)[number];

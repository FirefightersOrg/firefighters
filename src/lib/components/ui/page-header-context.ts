import { getContext, setContext } from 'svelte';

const KEY = Symbol('page-header-roots');

/**
 * Addresses the surrounding shell already offers on every page (the campaign's home, the campaign
 * list, the portal's home). A `PageHeader` does not repeat them as its back link.
 */
export function setPageHeaderRoots(roots: () => readonly string[]): void {
	setContext(KEY, roots);
}

/** The roots set by the nearest shell, read lazily (they depend on the current campaign). */
export function pageHeaderRoots(): () => readonly string[] {
	return getContext<(() => readonly string[]) | undefined>(KEY) ?? (() => []);
}

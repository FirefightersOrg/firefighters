import { error } from '@sveltejs/kit';
import { requireOwnCollector, type OwnCollector } from '$lib/server/auth/own-collector';
import { PORTAL_PAGE_SIZE } from '$lib/server/repositories/portal';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shared guard of the portal sales/buyers screens: own collector from the session, `sale.view_own`. */
export function requireSalesViewer(locals: App.Locals, url: URL): Promise<OwnCollector | null> {
	return requireOwnCollector(locals, url.pathname + url.search, 'sale.view_own');
}

/** A malformed id can never match a row: 404, not a database error. */
export function requireUuid(value: string, message: string): string {
	if (!UUID.test(value)) error(404, { message });
	return value;
}

export function pageParam(url: URL): number {
	const page = Number(url.searchParams.get('page'));
	return Number.isInteger(page) && page >= 1 ? Math.min(page, 10_000) : 1;
}

export function pagination(page: { total: number; page: number }) {
	return { page: page.page, pageCount: Math.max(1, Math.ceil(page.total / PORTAL_PAGE_SIZE)) };
}

export function loadFailed(locals: App.Locals, what: string, cause: unknown): never {
	console.error(`[portal] ${what} failed`, { requestId: locals.requestId, error: cause });
	error(500, { message: `No se pudo cargar ${what}. Volver a intentar.` });
}

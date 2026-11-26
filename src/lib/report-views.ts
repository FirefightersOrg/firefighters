import type { StatusMeta } from '$lib/components/ui/status';
/** Presentation only. Report queries and exports keep their original filters and complete rows. */
export const OPERATIONAL_VIEWS = [
	{ id: 'by-status', label: 'Bonos por estado' },
	{ id: 'by-collector', label: 'Bonos por cobrador' },
	{ id: 'installments', label: 'Cuotas' },
	{ id: 'overdue-warning', label: 'Ventas con mora' },
	{ id: 'monthly', label: 'Resumen mensual' }
] as const;
export const FINANCIAL_VIEWS = [
	{ id: 'payments', label: 'Pagos' },
	{ id: 'settlements', label: 'Rendiciones' },
	{ id: 'accounts', label: 'Cuentas' },
	{ id: 'ledger', label: 'Movimientos' },
	{ id: 'rosters', label: 'Padrones' },
	{ id: 'roster', label: 'Números del padrón' },
	{ id: 'prizes', label: 'Premios' }
] as const;

export function reportView(
	params: URLSearchParams,
	views: readonly { id: string }[],
	fallback = views[0].id
): string {
	const value = params.get('view');
	return views.some((view) => view.id === value) ? value! : fallback;
}

export function reportPage(value: string | null): number {
	const page = Number(value);
	return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export function reportHref(
	base: string,
	params: Record<string, string | null | undefined>,
	view: string,
	page = 1
): string {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
	query.set('view', view);
	if (page > 1) query.set('page', String(page));
	return `${base}?${query}`;
}

export const REPORT_ROWS_PER_PAGE = 10;

export type ReportRow = {
	id: string;
	values: Record<string, string>;
	href?: string;
	bond?: string | number;
	marks?: Record<string, StatusMeta>;
};
export interface ReportField {
	key: string;
	label: string;
	numeric?: boolean;
}

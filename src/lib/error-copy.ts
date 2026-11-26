import { GENERIC_ERROR_MESSAGE } from './copy';

/**
 * What an error page says (UX plan PR 6, audit A13): what happened and what to do, in Spanish, for
 * the statuses a person can meet. Pure and client-safe, so it is tested without rendering.
 *
 * The server's 403 carries the missing permission (`{ code: 'permission_denied', permission }`) and
 * an English message; the page never shows that message. It says whose section it is instead.
 */
export interface ErrorCopy {
	/** The page's heading. */
	title: string;
	/** One or two sentences: what happened and what to do. */
	body: string;
	/** Whether offering to try again makes sense (a failure, not a denial or a missing record). */
	retry: boolean;
}

/** Who a section belongs to, by the permission that guards it. */
const AREAS: [RegExp, string][] = [
	[/^(settlement|payment|commission|collector\.ledger)\./, 'tesorería'],
	[/^report\.view_financial$/, 'tesorería'],
	[/^(audit|user)\./, 'administración'],
	[/^campaign\.(create|update|update_rules|close)$/, 'administración'],
	[/^draw\.(create|update|annul|complete)$/, 'administración'],
	[/^prize\./, 'administración'],
	[
		/^(bond\.(create|import|scan|assign|return|mark_lost|annul)|sale\.(create|correct))$/,
		'operación'
	],
	[/^(buyer|collector)\.manage$/, 'operación']
];

/** «tesorería», «operación» or «administración» for a permission code, or null when it is none. */
export function areaOf(permission: string | undefined | null): string | null {
	if (!permission) return null;
	return AREAS.find(([pattern]) => pattern.test(permission))?.[1] ?? null;
}

/** Messages SvelteKit and the server put on an error that are not meant for a person. */
const NOT_FOR_PEOPLE = new Set(['Forbidden', 'Not Found', 'Not found', 'Internal Error', 'Error']);

export function errorCopy(
	status: number,
	error: { message?: string; code?: string; permission?: string } | null | undefined
): ErrorCopy {
	const message = error?.message?.trim();
	const own =
		message && !NOT_FOR_PEOPLE.has(message) && !/^Error:? \d{3}/.test(message) ? message : null;

	if (status === 403) {
		const area = areaOf(error?.permission);
		return {
			title: 'Sin acceso a esta sección',
			body: area
				? `Esta sección es de ${area}. Para usarla, pedir el acceso a quien administra el sistema.`
				: (own ??
					'El usuario no tiene permiso para ver esta sección. Pedir el acceso a quien administra el sistema.'),
			retry: false
		};
	}
	if (status === 404) {
		return {
			title: 'No se encontró',
			body: own
				? `${own} Revisar la dirección o volver a la lista.`
				: 'La dirección no existe o el registro ya no está. Revisar la dirección o volver a la lista.',
			retry: false
		};
	}
	if (status === 401) {
		return {
			title: 'Hace falta iniciar sesión',
			body: 'La sesión terminó. Iniciar sesión de nuevo para seguir.',
			retry: false
		};
	}
	return {
		title: 'No se pudo cargar',
		body: own ?? GENERIC_ERROR_MESSAGE,
		retry: true
	};
}

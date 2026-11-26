import { env } from '$env/dynamic/public';

/**
 * The institution the app is deployed for, as the interface names it (`PUBLIC_INSTITUTION_NAME`,
 * the same value printed on documents). Shown beside the red mark instead of the repository's name.
 */
export const INSTITUTION_FALLBACK = 'Bomberos Voluntarios';

export function institutionName(): string {
	return env.PUBLIC_INSTITUTION_NAME?.trim() || INSTITUTION_FALLBACK;
}

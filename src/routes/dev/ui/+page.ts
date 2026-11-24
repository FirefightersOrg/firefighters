import { error } from '@sveltejs/kit';
import { dev } from '$app/environment';

// Dev-only review page for the Cimiento UI kit: not reachable in production builds.
export const prerender = false;

export function load() {
	if (!dev) error(404, 'Not found');
	return {};
}

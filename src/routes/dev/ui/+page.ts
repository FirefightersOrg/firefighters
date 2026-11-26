import { error } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/public';

// Review page for the Cimiento UI kit. Not reachable in production builds, unless the E2E server
// opts in with PUBLIC_UI_KIT_SHOWCASE=1 (playwright.config.ts): the UI-kit spec runs against the build.
export const prerender = false;

export function load() {
	if (!dev && env.PUBLIC_UI_KIT_SHOWCASE !== '1') error(404, 'Not found');
	return {};
}

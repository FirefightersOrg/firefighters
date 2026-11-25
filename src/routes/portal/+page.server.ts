import type { PageServerLoad } from './$types';
import { requireOwnCollector } from '$lib/server/auth/own-collector';

export const load: PageServerLoad = async ({ locals, url }) => {
	const collector = await requireOwnCollector(locals, url.pathname + url.search);
	return { collector };
};

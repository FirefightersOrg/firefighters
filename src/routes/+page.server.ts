import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user || !locals.profile) {
		return {
			user: null,
			profile: null,
			roles: []
		};
	}

	const { data: userRoles } = await locals.supabase
		.from('user_roles')
		.select('roles(name)')
		.eq('user_id', locals.profile.id);

	const roles: string[] = [];
	if (userRoles) {
		for (const ur of userRoles as unknown as Array<{
			roles: { name: string } | Array<{ name: string }> | null;
		}>) {
			if (ur.roles) {
				if (Array.isArray(ur.roles)) {
					for (const r of ur.roles) {
						if (r?.name) roles.push(r.name);
					}
				} else if (ur.roles.name) {
					roles.push(ur.roles.name);
				}
			}
		}
	}

	return {
		user: locals.user,
		profile: locals.profile,
		roles
	};
};

export const actions: Actions = {
	logout: async ({ locals }) => {
		await locals.supabase.auth.signOut();
		redirect(303, '/login');
	}
};

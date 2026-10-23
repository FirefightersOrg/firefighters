// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { Session, User, SupabaseClient } from '@supabase/supabase-js';

export interface UserProfile {
	id: string;
	auth_user_id: string;
	full_name: string;
	email: string;
	status: 'active' | 'inactive';
	created_at: string;
}

declare global {
	namespace App {
		interface Error {
			message: string;
			code?: string;
			permission?: string;
		}
		interface Locals {
			supabase: SupabaseClient;
			safeGetSession: () => Promise<{ session: Session | null; user: User | null }>;
			session: Session | null;
			user: User | null;
			profile?: UserProfile | null;
			permissions?: string[];
			requestId?: string;
		}
		interface PageData {
			session?: Session | null;
			user?: User | null;
			profile?: UserProfile | null;
			permissions?: string[];
			roles?: string[];
			reason?: string | null;
			redirectTo?: string | null;
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};

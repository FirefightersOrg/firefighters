import { describe, it, expect } from 'vitest';
import {
	decideRouteAccess,
	isApiPath,
	isPublicPath,
	loginRedirectLocation,
	mayEndLeftoverSession
} from './route-guard';

function access(
	path: string,
	options: {
		method?: string;
		authenticated?: boolean;
		sessionExpired?: boolean;
		profileLookupFailed?: boolean;
	} = {}
) {
	return decideRouteAccess({
		url: new URL(path, 'http://localhost:5173'),
		method: options.method ?? 'GET',
		authenticated: options.authenticated ?? false,
		sessionExpired: options.sessionExpired ?? false,
		profileLookupFailed: options.profileLookupFailed
	});
}

describe('isPublicPath', () => {
	it.each([
		'/',
		'/login',
		'/logout',
		'/robots.txt',
		'/favicon.ico',
		'/manifest.webmanifest',
		'/service-worker.js',
		'/offline.html',
		'/icons/icon-192.png',
		'/_app/version.json',
		'/_app/env.js',
		'/_app/immutable/entry/start.js',
		'/_app/immutable/assets/favicon.svg'
	])('allows %s', (path) => {
		expect(isPublicPath(path)).toBe(true);
	});

	it.each([
		'/campaigns',
		'/campaigns/123/bonds',
		'/imports',
		'/scan',
		'/api/admin/users',
		'/login-admin',
		'/loginx',
		'/login/extra',
		'/logout/extra',
		'/_app/remote/abc/fn',
		'/_app',
		'/some-new-route'
	])('protects %s by default', (path) => {
		expect(isPublicPath(path)).toBe(false);
	});
});

describe('isApiPath', () => {
	it('matches /api and anything under it only', () => {
		expect(isApiPath('/api')).toBe(true);
		expect(isApiPath('/api/admin/users')).toBe(true);
		expect(isApiPath('/apiary')).toBe(false);
		expect(isApiPath('/campaigns')).toBe(false);
	});
});

describe('mayEndLeftoverSession', () => {
	it('leaves the session alone on /login and /logout, which manage it themselves', () => {
		expect(mayEndLeftoverSession('/login')).toBe(false);
		expect(mayEndLeftoverSession('/logout')).toBe(false);
	});

	it('ends it everywhere else, public or not', () => {
		expect(mayEndLeftoverSession('/')).toBe(true);
		expect(mayEndLeftoverSession('/campaigns')).toBe(true);
	});
});

describe('loginRedirectLocation', () => {
	it('keeps the return path, URL-encoded', () => {
		expect(loginRedirectLocation('/campaigns/1?tab=bonds', false)).toBe(
			'/login?redirectTo=%2Fcampaigns%2F1%3Ftab%3Dbonds'
		);
	});

	it('omits redirectTo for the home page', () => {
		expect(loginRedirectLocation('/', false)).toBe('/login');
		expect(loginRedirectLocation('/', true)).toBe('/login?reason=expired');
	});

	it('adds reason=expired when the session expired', () => {
		expect(loginRedirectLocation('/campaigns', true)).toBe(
			'/login?redirectTo=%2Fcampaigns&reason=expired'
		);
	});

	it.each(['//evil.com', '/\\evil.com', '/%2F/evil.com', 'https://evil.com'])(
		'drops an unsafe return path %j (no open redirect)',
		(path) => {
			expect(loginRedirectLocation(path, false)).toBe('/login');
		}
	);
});

describe('decideRouteAccess', () => {
	it('allows an active user anywhere', () => {
		expect(access('/campaigns', { authenticated: true })).toEqual({ kind: 'allow' });
		expect(access('/api/admin/users', { authenticated: true, method: 'POST' })).toEqual({
			kind: 'allow'
		});
	});

	it('allows anonymous visitors on public paths', () => {
		expect(access('/login?redirectTo=%2Fcampaigns')).toEqual({ kind: 'allow' });
		expect(access('/')).toEqual({ kind: 'allow' });
		expect(access('/logout', { method: 'POST' })).toEqual({ kind: 'allow' });
	});

	it('redirects anonymous visitors of a protected page to /login, keeping path and query', () => {
		expect(access('/campaigns/42/bonds?page=2')).toEqual({
			kind: 'redirect',
			location: '/login?redirectTo=%2Fcampaigns%2F42%2Fbonds%3Fpage%3D2'
		});
	});

	it('protects routes that do not exist yet (protected by default)', () => {
		expect(access('/imports/new')).toEqual({
			kind: 'redirect',
			location: '/login?redirectTo=%2Fimports%2Fnew'
		});
	});

	it('drops the ?/action query of a form action from the return path', () => {
		expect(access('/campaigns/new?/create', { method: 'POST' })).toEqual({
			kind: 'redirect',
			location: '/login?redirectTo=%2Fcampaigns%2Fnew'
		});
	});

	it('adds reason=expired when the visitor brought a session that no longer works', () => {
		expect(access('/campaigns', { sessionExpired: true })).toEqual({
			kind: 'redirect',
			location: '/login?redirectTo=%2Fcampaigns&reason=expired'
		});
	});

	it('answers 401 instead of redirecting for API endpoints', () => {
		expect(access('/api/admin/users', { method: 'POST' })).toEqual({ kind: 'unauthorized' });
	});

	it('answers unavailable (page) when the profile lookup failed, instead of redirecting', () => {
		expect(access('/campaigns', { profileLookupFailed: true })).toEqual({
			kind: 'unavailable',
			api: false
		});
	});

	it('answers unavailable (api) when the profile lookup failed, instead of 401', () => {
		expect(access('/api/admin/users', { profileLookupFailed: true })).toEqual({
			kind: 'unavailable',
			api: true
		});
	});

	it('keeps public paths open when the profile lookup failed', () => {
		expect(access('/login', { profileLookupFailed: true })).toEqual({ kind: 'allow' });
	});

	it('never builds an off-site redirect from a crafted path', () => {
		// A request for `http://app//evil.com` has the pathname `//evil.com`.
		const result = decideRouteAccess({
			url: new URL('http://localhost:5173//evil.com/x'),
			method: 'GET',
			authenticated: false,
			sessionExpired: false
		});
		expect(result).toEqual({ kind: 'redirect', location: '/login' });
	});
});

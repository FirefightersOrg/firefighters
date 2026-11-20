import { describe, expect, it } from 'vitest';
import {
	cacheName,
	isCacheableAsset,
	isHandledRequest,
	isNavigationRequest,
	isPrecachablePath,
	isSensitivePath,
	staleCacheNames
} from './cache-policy';

const ORIGIN = 'https://app.example.com';
const u = (path: string) => new URL(path, ORIGIN);
const get = { method: 'GET', mode: 'no-cors' };
const precached = new Set([
	'/_app/immutable/entry/start.js',
	'/offline.html',
	'/manifest.webmanifest'
]);

describe('isSensitivePath', () => {
	it.each(['/api', '/api/campaigns', '/campaigns/__data.json', '/_app/remote/abc'])(
		'flags %s',
		(p) => expect(isSensitivePath(p)).toBe(true)
	);
	it.each(['/', '/login', '/apiary', '/_app/immutable/x.js'])('does not flag %s', (p) =>
		expect(isSensitivePath(p)).toBe(false)
	);
});

describe('isHandledRequest', () => {
	it('handles same-origin GET', () => {
		expect(isHandledRequest(get, u('/login'), ORIGIN)).toBe(true);
	});
	it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('never handles %s (form posts, mutations)', (m) => {
		expect(isHandledRequest({ method: m }, u('/login'), ORIGIN)).toBe(false);
	});
	it('never handles Supabase or other cross-origin requests', () => {
		const remote = new URL('https://abc.supabase.co/rest/v1/profiles');
		expect(isHandledRequest(get, remote, ORIGIN)).toBe(false);
		const local = new URL('http://127.0.0.1:54321/auth/v1/token');
		expect(isHandledRequest(get, local, ORIGIN)).toBe(false);
	});
	it('never handles /api', () => {
		expect(isHandledRequest(get, u('/api/payments'), ORIGIN)).toBe(false);
	});
});

describe('isCacheableAsset', () => {
	it('serves precached static assets', () => {
		expect(isCacheableAsset(get, u('/_app/immutable/entry/start.js'), ORIGIN, precached)).toBe(
			true
		);
	});
	it('never caches authenticated pages or navigations', () => {
		expect(isCacheableAsset(get, u('/campaigns'), ORIGIN, precached)).toBe(false);
		const nav = { method: 'GET', mode: 'navigate' };
		expect(isCacheableAsset(nav, u('/offline.html'), ORIGIN, precached)).toBe(false);
	});
	it('never caches api, supabase, non-GET', () => {
		expect(isCacheableAsset(get, u('/api/x'), ORIGIN, new Set(['/api/x']))).toBe(false);
		const supabase = new URL('https://abc.supabase.co/_app/immutable/entry/start.js');
		expect(isCacheableAsset(get, supabase, ORIGIN, precached)).toBe(false);
		expect(isCacheableAsset({ method: 'POST' }, u('/offline.html'), ORIGIN, precached)).toBe(false);
	});
});

describe('isNavigationRequest', () => {
	it('detects navigate mode', () => {
		expect(isNavigationRequest({ method: 'GET', mode: 'navigate' })).toBe(true);
		expect(isNavigationRequest(get)).toBe(false);
	});
});

describe('isPrecachablePath', () => {
	it('excludes the worker, the root HTML and sensitive paths', () => {
		expect(isPrecachablePath('/service-worker.js')).toBe(false);
		expect(isPrecachablePath('/')).toBe(false);
		expect(isPrecachablePath('/api/x')).toBe(false);
		expect(isPrecachablePath('/offline.html')).toBe(true);
	});
});

describe('cache versioning', () => {
	it('deletes only our old caches', () => {
		const names = [cacheName('v1'), cacheName('v2'), 'other-app-cache'];
		expect(staleCacheNames(names, 'v2')).toEqual([cacheName('v1')]);
	});
});

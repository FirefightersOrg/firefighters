import { describe, expect, it } from 'vitest';
import { DEFAULT_BASE_URL, assertOnBaseUrl, resolveLocalBaseUrl, runEach } from './ux-local';

describe('resolveLocalBaseUrl', () => {
	it('defaults to the local dev server', () => {
		expect(resolveLocalBaseUrl(undefined)).toBe(DEFAULT_BASE_URL);
		expect(resolveLocalBaseUrl('  ')).toBe(DEFAULT_BASE_URL);
	});

	it.each([
		['http://127.0.0.1:4317', 'http://127.0.0.1:4317'],
		['http://localhost:5173/', 'http://localhost:5173'],
		['https://localhost:8443/campaigns?x=1', 'https://localhost:8443'],
		['http://[::1]:5173', 'http://[::1]:5173']
	])('accepts the local URL %s and returns its origin', (value, origin) => {
		expect(resolveLocalBaseUrl(value)).toBe(origin);
	});

	it.each([
		'https://firefighters.example.com',
		'https://staging.example.com:5173',
		// Look-alikes: the host is what counts, not what the string starts with.
		'http://127.0.0.1.example.com',
		'http://localhost.example.com',
		'http://localhost@example.com',
		'http://example.com/127.0.0.1',
		'http://192.168.0.10:5173',
		'http://0.0.0.0:5173'
	])('refuses the remote URL %s', (value) => {
		expect(() => resolveLocalBaseUrl(value)).toThrow(/Refusing to run against/);
	});

	it('refuses what is not an http(s) URL', () => {
		expect(() => resolveLocalBaseUrl('localhost:5173')).toThrow(/http\(s\)/);
		expect(() => resolveLocalBaseUrl('file:///etc/hosts')).toThrow(/http\(s\)/);
		expect(() => resolveLocalBaseUrl('not a url')).toThrow(/not a valid URL/);
	});
});

describe('assertOnBaseUrl', () => {
	it('accepts a page on the base origin', () => {
		expect(() =>
			assertOnBaseUrl('http://127.0.0.1:5173/login?next=%2F', 'http://127.0.0.1:5173')
		).not.toThrow();
	});

	it('refuses a login page that ended up on another origin', () => {
		expect(() => assertOnBaseUrl('https://example.com/login', 'http://127.0.0.1:5173')).toThrow(
			/Refusing to sign in/
		);
		expect(() => assertOnBaseUrl('http://127.0.0.1:9999/login', 'http://127.0.0.1:5173')).toThrow(
			/Refusing to sign in/
		);
		expect(() => assertOnBaseUrl('about:blank', 'http://127.0.0.1:5173')).toThrow(
			/Refusing to sign in/
		);
	});
});

describe('runEach', () => {
	it('exits 0 when every attempt completes', async () => {
		const outcome = await runEach(['a', 'b'], async (name) => ({ result: name, error: null }));
		expect(outcome).toEqual({ results: ['a', 'b'], failed: [], exitCode: 0 });
	});

	it('keeps every result but exits 1 when an attempt fails', async () => {
		const ran: string[] = [];
		const outcome = await runEach(['a', 'b', 'c'], async (name) => {
			ran.push(name);
			return { result: { flow: name }, error: name === 'b' ? 'Timeout 30000ms exceeded.' : null };
		});
		// The failure does not stop the flows after it, and its partial result stays in the report.
		expect(ran).toEqual(['a', 'b', 'c']);
		expect(outcome.results).toEqual([{ flow: 'a' }, { flow: 'b' }, { flow: 'c' }]);
		expect(outcome.failed).toEqual(['b']);
		expect(outcome.exitCode).toBe(1);
	});

	it('exits 0 when nothing was selected', async () => {
		expect(await runEach([], async () => ({ result: 1, error: null }))).toEqual({
			results: [],
			failed: [],
			exitCode: 0
		});
	});
});

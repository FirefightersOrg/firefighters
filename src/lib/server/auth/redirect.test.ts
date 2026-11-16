import { describe, it, expect } from 'vitest';
import { getSafeRedirectPath } from './redirect';

describe('getSafeRedirectPath', () => {
	it('returns "/" for missing or non-string values', () => {
		expect(getSafeRedirectPath(null)).toBe('/');
		expect(getSafeRedirectPath(undefined)).toBe('/');
		expect(getSafeRedirectPath('')).toBe('/');
		expect(getSafeRedirectPath(42)).toBe('/');
	});

	it('allows same-origin relative paths, keeping query and hash', () => {
		expect(getSafeRedirectPath('/')).toBe('/');
		expect(getSafeRedirectPath('/ok/path?x=1')).toBe('/ok/path?x=1');
		expect(getSafeRedirectPath('/campaigns/123#tickets')).toBe('/campaigns/123#tickets');
		expect(getSafeRedirectPath('/search?q=a%20b')).toBe('/search?q=a%20b');
	});

	it.each([
		['//evil.com'],
		['/\\evil.com'],
		['\\\\evil.com'],
		['/\t/evil.com'],
		['/\n/evil.com'],
		['/\r/evil.com'],
		['/ /evil.com'],
		['/%09/evil.com'],
		['/%2F/evil.com'],
		['/%5Cevil.com'],
		['https://evil.com'],
		['http:/evil.com'],
		['javascript:alert(1)'],
		['evil.com'],
		['ok/path']
	])('rejects %j', (target) => {
		expect(getSafeRedirectPath(target)).toBe('/');
	});

	it('rejects malformed percent-encoding', () => {
		expect(getSafeRedirectPath('/%E0%A4%A')).toBe('/');
	});
});

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SAN-91: the service-role key and the admin (service-role) client never reach client code.
 * SvelteKit refuses to bundle `$lib/server/**` and `$env/static|dynamic/private` into the browser,
 * so the guard is that every reference lives in a server-only module.
 */
const ROOT = join(process.cwd(), 'src');
function files(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? files(path) : [path];
	});
}
const sources = files(ROOT)
	.filter((path) => /\.(ts|js|svelte)$/.test(path) && !/\.test\.ts$/.test(path))
	.map((path) => ({
		path: relative(ROOT, path).split(sep).join('/'),
		text: readFileSync(path, 'utf8')
	}));
/** Server-only per SvelteKit: $lib/server/**, endpoints (+server.ts) and any *.server.ts module. */
const serverOnly = (path: string) =>
	path.startsWith('lib/server/') || /(^|\/)\+server\.ts$/.test(path) || /\.server\.ts$/.test(path);

describe('service-role key exposure (SAN-91)', () => {
	it('references SUPABASE_SERVICE_ROLE_KEY only in server-only modules', () => {
		const offenders = sources
			.filter((file) => file.text.includes('SUPABASE_SERVICE_ROLE_KEY'))
			.map((file) => file.path)
			.filter((path) => !serverOnly(path));
		expect(offenders).toEqual([]);
		expect(sources.some((file) => file.text.includes('SUPABASE_SERVICE_ROLE_KEY'))).toBe(true);
	});
	it('imports the service-role admin client only from server-only modules', () => {
		const offenders = sources
			.filter((file) =>
				/\$lib\/server\/supabase\/admin|['"]\.\.?\/.*supabase\/admin['"]/.test(file.text)
			)
			.map((file) => file.path)
			.filter((path) => !serverOnly(path));
		expect(offenders).toEqual([]);
	});
	it('never reads private env from components, domain code or client modules', () => {
		const offenders = sources
			.filter(
				(file) =>
					file.text.includes('$env/static/private') || file.text.includes('$env/dynamic/private')
			)
			.map((file) => file.path)
			.filter((path) => !serverOnly(path));
		expect(offenders).toEqual([]);
	});
});

import { describe, expect, it } from 'vitest';
import { findRawPalette, isChecked } from './check-palette';

describe('raw palette guardrail (SAN-137)', () => {
	it('flags raw palette utilities, with variants and opacity', () => {
		const text =
			'<p class="text-slate-700 hover:bg-blue-50 dark:border-red-400/20 ring-amber-950">';
		expect(findRawPalette('a.svelte', text).map((o) => o.match)).toEqual([
			'text-slate-700',
			'hover:bg-blue-50',
			'dark:border-red-400/20',
			'ring-amber-950'
		]);
	});
	it('reports the line of each offence', () => {
		expect(findRawPalette('a.svelte', 'ok\n<b class="bg-gray-100">')).toEqual([
			{ file: 'a.svelte', line: 2, match: 'bg-gray-100' }
		]);
	});
	it('accepts the semantic tokens and look-alikes', () => {
		const text =
			'bg-surface text-muted text-danger-text border-border text-number-lg --color-slate-500 grid-cols-2 my-red-700x';
		expect(findRawPalette('a.svelte', text)).toEqual([]);
	});
	it('checks app code but not the ui kit or tests', () => {
		expect(isChecked('src/routes/x/+page.svelte')).toBe(true);
		expect(isChecked('src/app.css')).toBe(true);
		expect(isChecked('src/lib/components/ui/Button.svelte')).toBe(false);
		expect(isChecked('src/lib/format.test.ts')).toBe(false);
		expect(isChecked('README.md')).toBe(false);
	});
});

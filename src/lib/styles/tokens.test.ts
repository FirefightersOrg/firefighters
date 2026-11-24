import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Themed = { name: string; value: Record<'light' | 'dark', string> };
type Plain = { name: string; value: string };

const tokens = JSON.parse(readFileSync('docs/design-system/tokens.json', 'utf8')) as {
	color: { tokens: Themed[] };
	shadow: { tokens: Themed[] };
	spacing: { tokens: Plain[] };
	radius: { tokens: Plain[] };
	size: { tokens: Plain[] };
	zIndex: { tokens: Plain[] };
};
const css = readFileSync('src/lib/styles/tokens.css', 'utf8');

/** Declarations of the first block that starts with `selector`. */
function block(selector: string): string {
	const start = css.indexOf(selector);
	expect(start, selector).toBeGreaterThanOrEqual(0);
	return css.slice(start, css.indexOf('\n}', start));
}

const lightBlock = block(':root {');
const darkBlock = block(':root[data-theme');
const mediaBlock = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));

describe('Cimiento tokens.css', () => {
	const themed = [...tokens.color.tokens, ...tokens.shadow.tokens];

	it.each(themed.map((t) => [t.name, t] as const))('themed token %s in both themes', (_n, t) => {
		expect(lightBlock).toContain(`--${t.name}: ${t.value.light};`);
		expect(darkBlock).toContain(`--${t.name}: ${t.value.dark};`);
		expect(mediaBlock).toContain(`--${t.name}: ${t.value.dark};`);
	});

	const plain = [
		...tokens.spacing.tokens,
		...tokens.radius.tokens,
		...tokens.size.tokens,
		...tokens.zIndex.tokens
	];
	it.each(plain.map((t) => [t.name, t] as const))('plain token %s', (_n, t) => {
		expect(lightBlock).toContain(`--${t.name}: ${t.value};`);
	});

	it('lets an explicit light theme win over the system dark preference', () => {
		expect(mediaBlock).toContain(":not([data-theme='light'])");
	});
});

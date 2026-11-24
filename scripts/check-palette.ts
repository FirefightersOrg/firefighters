/**
 * SAN-137 guardrail: raw Tailwind palette utilities (`bg-slate-100`, `text-red-700`, …) are allowed
 * only inside the Cimiento kit (`src/lib/components/ui/`). Everything else uses the semantic tokens
 * (`bg-surface`, `text-danger-text`, …) so light/dark themes and the palette stay in one place.
 *
 * Usage: `tsx scripts/check-palette.ts [files…]`. Without arguments it scans `src/`. With file
 * arguments (lint-staged) it checks only those. Exits 1 and lists every offence when any is found.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PREFIXES =
	'bg|text|border|border-[trblxy]|ring|ring-offset|from|to|via|divide|outline|fill|stroke|placeholder|accent|decoration|shadow|caret';
const COLORS =
	'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
/** A utility, optionally with variants (`hover:`, `dark:`…) and an opacity (`/20`). */
export const RAW_PALETTE = new RegExp(
	`(?<![\\w-])(?:[\\w-]+:)*(?:${PREFIXES})-(?:${COLORS})-(?:50|[1-9]00|950)(?:\\/\\d+)?(?![\\w-])`,
	'g'
);
const CHECKED = /\.(svelte|ts|js|css)$/;
const ALLOWED_DIR = 'src/lib/components/ui/';

export interface Offence {
	file: string;
	line: number;
	match: string;
}

export function isChecked(path: string) {
	const normalized = path.split(sep).join('/');
	return (
		normalized.startsWith('src/') &&
		CHECKED.test(normalized) &&
		!normalized.startsWith(ALLOWED_DIR) &&
		!/\.test\.ts$/.test(normalized)
	);
}

export function findRawPalette(file: string, text: string): Offence[] {
	return text
		.split('\n')
		.flatMap((content, index) =>
			[...content.matchAll(RAW_PALETTE)].map((m) => ({ file, line: index + 1, match: m[0] }))
		);
}

function walk(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});
}

function main(args: string[]) {
	const root = process.cwd();
	const files = (args.length ? args : walk(join(root, 'src')))
		.map((path) =>
			relative(root, join(root, relative(root, path)))
				.split(sep)
				.join('/')
		)
		.filter(isChecked);
	const offences = files.flatMap((file) => findRawPalette(file, readFileSync(file, 'utf8')));
	if (!offences.length) return 0;
	for (const o of offences) console.error(`${o.file}:${o.line}  ${o.match}`);
	console.error(
		`\n${offences.length} raw palette utilities outside ${ALLOWED_DIR}. Use the Cimiento tokens ` +
			'(bg-surface, text-muted, text-danger-text, border-border, …) or a ui/ component instead.'
	);
	return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));

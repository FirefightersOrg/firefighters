import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { POSTGREST_MAX_ROWS } from './postgrest';
import { REPORT_PAGE_SIZE } from './domain/financial-reports';
import { BOND_NUMBERS_PAGE_SIZE } from './server/repositories/bonds';
import { EXPORT_PAGE_SIZE } from './server/backups/export';
import { OVERDUE_PAGE_SIZE } from './server/repositories/reports';
import { LEDGER_PAGE_SIZE } from './server/services/commission-ledger';

describe('PostgREST page size (SAN-150)', () => {
	it('matches [api] max_rows in supabase/config.toml', () => {
		const config = readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8');
		const api = config.split(/^\[/m).find((section) => section.startsWith('api]'));
		const maxRows = Number(api?.match(/^max_rows\s*=\s*(\d+)/m)?.[1]);
		expect(maxRows).toBe(POSTGREST_MAX_ROWS);
	});
	it('is the page size of every paged read', () => {
		for (const size of [
			REPORT_PAGE_SIZE,
			BOND_NUMBERS_PAGE_SIZE,
			EXPORT_PAGE_SIZE,
			OVERDUE_PAGE_SIZE,
			LEDGER_PAGE_SIZE
		])
			expect(size).toBe(POSTGREST_MAX_ROWS);
	});
});

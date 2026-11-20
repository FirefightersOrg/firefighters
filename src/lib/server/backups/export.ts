import type { SupabaseClient } from '@supabase/supabase-js';
import { BACKUP_EXPORTS, type BackupExportKind, type ExportRow } from '$lib/domain/backup-exports';
import { CSV_BOM, csvHeaderLine, csvRowLines } from '$lib/domain/csv-export';

/** Must not exceed PostgREST `max_rows` (1000 in supabase/config.toml). */
export const EXPORT_PAGE_SIZE = 1000;

/** Reads one page of rows strictly after `after` (null = from the start), in the total order. */
export type FetchPage = (
	after: ExportRow | null
) => Promise<{ data: ExportRow[] | null; error: unknown }>;

/**
 * Reads every page with keyset pagination (each page starts after the last row of the previous
 * one) until a short page, so rows inserted or removed meanwhile never shift pages into duplicates
 * or gaps. Throws on error, so a failed export never yields a truncated file that looks complete.
 */
export async function* paginateAll(
	fetchPage: FetchPage,
	pageSize = EXPORT_PAGE_SIZE
): AsyncGenerator<ExportRow[]> {
	let after: ExportRow | null = null;
	for (;;) {
		const { data, error } = await fetchPage(after);
		if (error) throw error;
		const rows = data ?? [];
		if (rows.length > 0) yield rows;
		if (rows.length < pageSize) return;
		after = rows[rows.length - 1];
	}
}

const quote = (v: unknown) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * PostgREST `or` filter for "strictly after `last`" in the ascending order `columns`:
 * (c1 > v1) or (c1 = v1 and c2 > v2) or ... Order columns must be non-null and in the select.
 */
export function keysetFilter(columns: readonly string[], last: ExportRow): string {
	return columns
		.map((c, i) => {
			const eq = columns.slice(0, i).map((p) => `${p}.eq.${quote(last[p])}`);
			return `and(${[...eq, `${c}.gt.${quote(last[c])}`].join(',')})`;
		})
		.join(',');
}

export interface ExportPeriod {
	from: string | null;
	to: string | null;
}

function nextDay(date: string): string {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + 1);
	return d.toISOString().slice(0, 10);
}

export function exportPageFetcher(
	supabase: SupabaseClient,
	kind: BackupExportKind,
	campaignId: string,
	period: ExportPeriod
): FetchPage {
	const def = BACKUP_EXPORTS[kind];
	return async (after) => {
		let q = supabase.from(def.table).select(def.select).eq('campaign_id', campaignId);
		if (def.periodColumn) {
			const isDate = def.periodColumn === 'payment_date';
			if (period.from) {
				q = q.gte(def.periodColumn, isDate ? period.from : `${period.from}T00:00:00-03:00`);
			}
			if (period.to) {
				q = isDate
					? q.lte(def.periodColumn, period.to)
					: q.lt(def.periodColumn, `${nextDay(period.to)}T00:00:00-03:00`);
			}
		}
		if (after) q = q.or(keysetFilter(def.order, after));
		for (const column of def.order) q = q.order(column, { ascending: true });
		const { data, error } = await q.limit(EXPORT_PAGE_SIZE);
		return { data: data as unknown as ExportRow[] | null, error };
	};
}

/**
 * CSV as a stream. The first page is read before the stream is returned so a failure becomes a
 * normal 500 instead of a half-written 200; later failures abort the stream (client sees an
 * incomplete download, never a file that looks complete).
 */
export async function streamExportCsv(
	supabase: SupabaseClient,
	kind: BackupExportKind,
	campaignId: string,
	period: ExportPeriod
): Promise<ReadableStream<Uint8Array>> {
	const def = BACKUP_EXPORTS[kind];
	const pages = paginateAll(exportPageFetcher(supabase, kind, campaignId, period));
	const first = await pages.next();
	const encoder = new TextEncoder();
	return new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(encoder.encode(CSV_BOM + csvHeaderLine(def.columns)));
			if (!first.done) controller.enqueue(encoder.encode(csvRowLines(def.columns, first.value)));
		},
		async pull(controller) {
			try {
				const next = first.done ? first : await pages.next();
				if (next.done) return controller.close();
				controller.enqueue(encoder.encode(csvRowLines(def.columns, next.value)));
			} catch (err) {
				console.error('[backups] export stream failed', { kind, campaignId, error: err });
				controller.error(err);
			}
		}
	});
}

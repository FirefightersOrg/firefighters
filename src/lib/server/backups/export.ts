import type { SupabaseClient } from '@supabase/supabase-js';
import { BACKUP_EXPORTS, type BackupExportKind, type ExportRow } from '$lib/domain/backup-exports';
import { CSV_BOM, csvHeaderLine, csvRowLines } from '$lib/domain/csv-export';

/** Must not exceed PostgREST `max_rows` (1000 in supabase/config.toml). */
export const EXPORT_PAGE_SIZE = 1000;

export type FetchPage = (
	from: number,
	to: number
) => Promise<{ data: ExportRow[] | null; error: unknown }>;

/**
 * Reads every page (offset ranges over a total, stable order) until a short page. Throws on error,
 * so a failed export never yields a truncated file that looks complete.
 */
export async function* paginateAll(
	fetchPage: FetchPage,
	pageSize = EXPORT_PAGE_SIZE
): AsyncGenerator<ExportRow[]> {
	for (let offset = 0; ; offset += pageSize) {
		const { data, error } = await fetchPage(offset, offset + pageSize - 1);
		if (error) throw error;
		const rows = data ?? [];
		if (rows.length > 0) yield rows;
		if (rows.length < pageSize) return;
	}
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
	return async (from, to) => {
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
		for (const column of def.order) q = q.order(column, { ascending: true });
		const { data, error } = await q.range(from, to);
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

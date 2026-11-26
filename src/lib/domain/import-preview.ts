/**
 * Presentation rules of the import screens (SAN-46): labels, the preview filter and when each
 * action is offered. The data rules (interpretation, validation, summary) live in `imports.ts`.
 */
import {
	type ImportItemStatus,
	type ImportSessionStatus,
	type ImportSourceType,
	type ImportSummary
} from './imports';
import { padNumber } from './barcodes';
import { formatNumber } from '$lib/format';

export const IMPORT_SOURCE_LABELS: Record<ImportSourceType, string> = {
	barcode_scan: 'Escaneo de códigos de barras',
	csv_file: 'Archivo CSV',
	excel_file: 'Archivo de Excel'
};

export const IMPORT_SESSION_STATUS_LABELS: Record<ImportSessionStatus, string> = {
	draft: 'Borrador',
	validated: 'Validada',
	confirmed: 'Confirmada',
	cancelled: 'Cancelada',
	failed: 'Fallida'
};

export const IMPORT_ITEM_STATUS_LABELS: Record<ImportItemStatus, string> = {
	pending: 'Pendiente',
	valid: 'Válido',
	warning: 'Con observaciones',
	error: 'Con error'
};

/** Statuses the preview table can be filtered by (`?status=`). */
export const IMPORT_ITEM_FILTERS = ['all', 'valid', 'warning', 'error'] as const;
export type ImportItemFilter = (typeof IMPORT_ITEM_FILTERS)[number];

export function parseImportItemFilter(value: string | null): ImportItemFilter {
	return (IMPORT_ITEM_FILTERS as readonly string[]).includes(value ?? '')
		? (value as ImportItemFilter)
		: 'all';
}

/** Rows and scans can still be changed (draft or validated). */
export function isImportSessionOpen(status: ImportSessionStatus): boolean {
	return status === 'draft' || status === 'validated';
}

type SummaryState = Pick<ImportSummary, 'errors' | 'liveItems'> & { status: ImportSessionStatus };

/** Confirm: validated, with rows and no blocking error (the database revalidates anyway). */
export function canConfirmImport(summary: SummaryState): boolean {
	return summary.status === 'validated' && summary.errors === 0 && summary.liveItems > 0;
}

/** Validate: a draft with at least one live row. */
export function canValidateImport(summary: SummaryState): boolean {
	return summary.status === 'draft' && summary.liveItems > 0;
}

/** Permission needed to work on a session of this source (docs/permissions.md). */
export function importSessionPermission(sourceType: ImportSourceType): 'bond.import' | 'bond.scan' {
	return sourceType === 'barcode_scan' ? 'bond.scan' : 'bond.import';
}

/** A staged number padded like the campaign (`0068`), a dash when missing; never throws. */
export function formatImportNumber(value: number | null, digits: number): string {
	return value === null ? '—' : padNumber(value, digits);
}

type SummaryCounts = Pick<
	ImportSummary,
	'simpleItems' | 'pataGroups' | 'participatingNumbers' | 'errors' | 'warnings' | 'pending'
>;

const count = (n: number, one: string, many: string) =>
	`${formatNumber(n)} ${n === 1 ? one : many}`;

/**
 * What the batch would create and what stands in the way, as the sentences that open the preview
 * (docs/copy.md: sentences, whole figures). An empty batch says so.
 */
export function importSummarySentences(summary: SummaryCounts): string[] {
	const bonds = summary.simpleItems + summary.pataGroups;
	if (bonds === 0 && summary.errors === 0 && summary.pending === 0) {
		return ['Todavía no hay filas para crear bonos.'];
	}
	const parts = [
		...(summary.simpleItems > 0 ? [count(summary.simpleItems, 'simple', 'simples')] : []),
		...(summary.pataGroups > 0 ? [count(summary.pataGroups, 'pata', 'patas')] : [])
	];
	const sentences = [
		bonds > 0
			? `${summary.errors > 0 ? 'Hay' : bonds === 1 ? 'Se crearía' : 'Se crearían'} ${count(bonds, 'bono', 'bonos')} (${parts.join(' y ')}), con ${count(summary.participatingNumbers, 'número participante', 'números participantes')}.`
			: 'Todavía no hay filas válidas para crear bonos.'
	];
	if (summary.errors > 0) {
		sentences.push(
			summary.errors === 1
				? '1 fila tiene un error que impide confirmar.'
				: `${formatNumber(summary.errors)} filas tienen errores que impiden confirmar.`
		);
	}
	if (summary.warnings > 0) {
		sentences.push(
			summary.warnings === 1
				? '1 fila tiene una observación para revisar.'
				: `${formatNumber(summary.warnings)} filas tienen observaciones para revisar.`
		);
	}
	return sentences;
}

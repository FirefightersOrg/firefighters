import type { SupabaseClient } from '@supabase/supabase-js';
import { auditEntity, snapshotReferences } from '$lib/audit-copy';
import { formatPaddedNumber } from '$lib/format';
import type { AuditEntry } from './repositories/audit-log';

/** Additional read-only context, always as the caller and behind the same read permissions. */
export async function describeAuditEntries(
	client: SupabaseClient,
	entries: AuditEntry[],
	permissions: readonly string[],
	digits: number
) {
	const refs = entries.map((entry) => {
		const old = snapshotReferences(entry.oldValue);
		const next = snapshotReferences(entry.newValue);
		const result: Record<string, string[]> = {};
		for (const key of new Set([...Object.keys(old), ...Object.keys(next)]))
			result[key] = [...(old[key] ?? []), ...(next[key] ?? [])];
		if (entry.entityId) (result[`${entry.entityType}_id`] ??= []).push(entry.entityId);
		return result;
	});
	const ids = (key: string) =>
		[...new Set(refs.flatMap((r) => r[key] ?? []))].filter((id) =>
			/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(id)
		);
	const can = (permission: string) => permissions.includes(permission);
	async function read(table: string, columns: string, selected: string[]) {
		if (!selected.length) return [];
		const rows: Record<string, unknown>[] = [];
		const unique = [...new Set(selected)];
		// Every chunk can return at most 100 rows, below the PostgREST ceiling.
		for (let start = 0; start < unique.length; start += 100) {
			const { data, error } = await client
				.from(table)
				.select(columns)
				.in('id', unique.slice(start, start + 100))
				.order('id');
			if (error) throw new Error(`Could not read audit context: ${table}`, { cause: error });
			rows.push(...((data ?? []) as unknown as Record<string, unknown>[]));
		}
		return rows;
	}
	// References may be nested in real correction snapshots (previous_value.payment, etc.).
	const payments = can('payment.view')
		? await read('payments', 'id,sale_id,collector_id', ids('payment_id'))
		: [];
	for (const ref of refs)
		for (const payment of payments)
			if (ref.payment_id?.includes(String(payment.id))) {
				if (payment.sale_id) (ref.sale_id ??= []).push(String(payment.sale_id));
				if (payment.collector_id) (ref.collector_id ??= []).push(String(payment.collector_id));
			}
	const sales = can('sale.view')
		? await read('sales', 'id,bond_id,buyer_id,collector_id', ids('sale_id'))
		: [];
	for (const ref of refs)
		for (const sale of sales)
			if (ref.sale_id?.includes(String(sale.id)))
				for (const key of ['bond_id', 'buyer_id', 'collector_id'])
					if (sale[key]) (ref[key] ??= []).push(String(sale[key]));
	const [bonds, collectors, buyers, settlements] = await Promise.all([
		can('bond.view')
			? read('bonds', 'id,bond_numbers(number_value,number_kind)', ids('bond_id'))
			: [],
		can('collector.view') ? read('collectors', 'id,display_name', ids('collector_id')) : [],
		can('buyer.view')
			? read('buyers', 'id,first_name,last_name,business_name', ids('buyer_id'))
			: [],
		can('settlement.view')
			? read('settlements', 'id,settlement_number,collector_id', ids('settlement_id'))
			: []
	]);
	const collectorIds = [...new Set(settlements.map((r) => String(r.collector_id)))];
	const settlementCollectors = can('collector.view')
		? await read('collectors', 'id,display_name', collectorIds)
		: [];
	const allCollectors = [...collectors, ...settlementCollectors];
	return entries.map((entry, i) => {
		const ref = refs[i];
		const parts: string[] = [];
		for (const bond of bonds)
			if (ref.bond_id?.includes(String(bond.id))) {
				const numbers = (bond.bond_numbers as { number_value: number; number_kind: string }[])
					.filter((n) => n.number_kind === 'base')
					.sort((a, b) => a.number_value - b.number_value);
				if (numbers.length)
					parts.push(
						`Bono ${numbers.map((n) => formatPaddedNumber(n.number_value, digits)).join(' + ')}`
					);
			}
		for (const settlement of settlements)
			if (ref.settlement_id?.includes(String(settlement.id))) {
				parts.push(`Rendición ${settlement.settlement_number}`);
				(ref.collector_id ??= []).push(String(settlement.collector_id));
			}
		for (const buyer of buyers)
			if (ref.buyer_id?.includes(String(buyer.id)))
				parts.push(
					String(
						buyer.business_name || [buyer.first_name, buyer.last_name].filter(Boolean).join(' ')
					)
				);
		for (const collector of allCollectors)
			if (ref.collector_id?.includes(String(collector.id)))
				parts.push(String(collector.display_name));
		// Snapshots are already readable through audit.view; only known human-name keys are used.
		for (const value of [entry.newValue, entry.oldValue])
			if (value && typeof value === 'object') {
				const v = value as Record<string, unknown>;
				const name =
					v.display_name ||
					v.business_name ||
					[v.first_name, v.last_name].filter(Boolean).join(' ') ||
					v.name;
				if (typeof name === 'string' && name.trim()) parts.push(name);
			}
		return { ...entry, subject: [...new Set(parts)].join(', ') || auditEntity(entry.entityType) };
	});
}

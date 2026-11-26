/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { NO_ACCESS_BUYER, NO_ACCESS_COLLECTOR } from '$lib/domain/parties';
import { formatMoney } from '$lib/format';
import Page from './+page.svelte';

const id = 'f0000000-0000-0000-0000-000000000001';
const collectorId = 'c0000000-0000-0000-0000-000000000001';
const campaign = {
	id,
	name: 'Campaign',
	numberDigits: 4,
	maxNumber: 9999,
	associatedNumberOffset: 4871,
	associatedNumberMode: 'linear',
	overflowPolicy: 'reject'
};
const item = {
	sale: {
		id: 's',
		collectorId,
		soldAt: '2026-10-16T15:00:00Z',
		paymentMode: 'full_payment',
		totalAmount: '60000.00',
		status: 'active'
	},
	bondNumberPairs: [
		{ base: 68, associated: 4939 },
		{ base: 69, associated: 4940 }
	],
	buyerName: 'Ada Lovelace',
	collectorName: 'Ana Cobradora',
	financialStatus: 'no_payments'
};
const noFilters = { collector: '', buyer: '', paymentMode: '', financialStatus: '' };
const page = (over: Record<string, unknown> = {}) =>
	render(Page, {
		props: {
			data: {
				campaign,
				sales: [item],
				collectors: [{ id: collectorId, displayName: 'Ana Cobradora' }],
				filters: noFilters,
				pagination: { page: 1, pageSize: 25, total: 1, pageCount: 1 },
				can: { create: true },
				...over
			},
			params: { id }
		} as any
	}).body;
/** Text of the page without tags or Svelte's hydration comments. */
const text = (body: string) =>
	body
		.replace(/<!--.*?-->/g, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ');

describe('sales list', () => {
	it('names the sale by its bond and its buyer, with the bond number as the link to the sale', () => {
		const body = page();
		// A pata is one sale: its numbers together, padded as the campaign prints them.
		expect(body).toMatch(
			new RegExp(
				`<a[^>]*href="/campaigns/${id}/sales/s"[^>]*data-bond-number[^>]*>.*?0068 \\+ 0069`
			)
		);
		expect(text(body)).toContain('4939 + 4940');
		expect(text(body)).toContain('Ada Lovelace');
		expect(text(body)).toContain('Lo cobra Ana Cobradora');
		expect(text(body)).toContain('16/10/2026');
		expect(text(body)).toContain('Sin pagos');
		// Whole pesos on a list, and one link per row: the names are not links.
		expect(body).toContain(formatMoney('60000'));
		expect(body).not.toContain(formatMoney('60000', { decimals: 'always' }));
		expect(body).not.toMatch(/href="[^"]*\/(buyers|collectors)\//);
		expect(text(body)).toContain('Mostrando 1–1 de 1 venta');
	});

	it('shows the Spanish stand-in, never a link or «Unknown», for a party the role cannot read', () => {
		const body = page({
			sales: [{ ...item, buyerName: NO_ACCESS_BUYER, collectorName: NO_ACCESS_COLLECTOR }]
		});
		expect(text(body)).toContain(NO_ACCESS_BUYER);
		expect(text(body)).toContain(NO_ACCESS_COLLECTOR);
		expect(text(body)).not.toContain(`Lo cobra ${NO_ACCESS_COLLECTOR}`);
		expect(body).not.toContain('Unknown');
	});

	it('says «Corregida» or «Anulada» for a sale that is no longer the active one', () => {
		const corrected = text(
			page({ sales: [{ ...item, sale: { ...item.sale, status: 'corrected' } }] })
		);
		// The table, without the filters above it (where «Sin pagos» is an option).
		const table = corrected.slice(corrected.indexOf('Ventas de la campaña'));
		expect(table).toContain('Corregida');
		expect(table).not.toContain('Sin pagos');
	});

	it('keeps every filter in the form, as chips and across pages', () => {
		const filters = {
			collector: collectorId,
			buyer: 'Ada',
			paymentMode: 'installments',
			financialStatus: 'overdue'
		};
		const body = page({
			filters,
			pagination: { page: 2, pageSize: 25, total: 60, pageCount: 3 }
		});
		expect(body).toMatch(/<input[^>]*name="buyer"[^>]*value="Ada"/);
		expect(body).toMatch(/<option value="overdue"[^>]*selected/);
		expect(body).not.toMatch(/<option value="no_payments"[^>]*selected/);
		expect(body).toMatch(/<option value="installments"[^>]*selected/);
		expect(body).toMatch(new RegExp(`<option value="${collectorId}"[^>]*selected`));
		const query = `collector=${collectorId}&amp;buyer=Ada&amp;paymentMode=installments&amp;financialStatus=overdue`;
		expect(body).toContain(`/sales?${query}&amp;page=3`);
		// Page 1 is the list without `page`.
		expect(body).toMatch(
			new RegExp(`href="/campaigns/${id}/sales\\?${query.replace(/\?/g, '\\?')}"[^>]*rel="prev"`)
		);
		expect(body).toContain('aria-label="Quitar el filtro Cobrador: Ana Cobradora"');
		expect(body).toContain('aria-label="Quitar el filtro Modalidad: En cuotas"');
		expect(body).toContain('aria-label="Quitar el filtro Pagos: En mora"');
		// Removing one keeps the others and goes back to the first page.
		expect(body).toContain(
			`/sales?collector=${collectorId}&amp;buyer=Ada&amp;paymentMode=installments"`
		);
		expect(text(body)).toContain('Mostrando 26–50 de 60 ventas');
		expect(text(body)).toContain('Quitar todos');
	});

	it('names a collector that is no longer active from the rows it filters', () => {
		const body = page({ collectors: [], filters: { ...noFilters, collector: collectorId } });
		expect(body).toContain('aria-label="Quitar el filtro Cobrador: Ana Cobradora"');
		expect(body).toMatch(new RegExp(`<option value="${collectorId}"[^>]*selected`));
	});

	it('says what to do when there are no sales, and what to change when nothing matches', () => {
		const pagination = { page: 1, pageSize: 25, total: 0, pageCount: 1 };
		const empty = text(page({ sales: [], pagination, can: { create: false } }));
		expect(empty).toContain('Todavía no hay ventas');
		expect(empty).toContain('Una venta se registra con un bono que ya tiene un cobrador');
		expect(empty).not.toContain('Registrar venta');
		expect(empty).not.toContain('Quitar todos');
		const noMatch = text(
			page({
				sales: [],
				pagination,
				filters: { ...noFilters, buyer: 'zzz', paymentMode: 'installments' }
			})
		);
		expect(noMatch).toContain('Ninguna venta coincide con los filtros');
		expect(noMatch).toContain('Quitar todos');
		const beyond = page({
			sales: [],
			pagination: { page: 9, pageSize: 25, total: 30, pageCount: 2 },
			filters: { ...noFilters, buyer: 'Ada' }
		});
		expect(text(beyond)).toContain('No hay ventas en esta página');
		expect(beyond).toContain(`href="/campaigns/${id}/sales?buyer=Ada"`);
	});
});

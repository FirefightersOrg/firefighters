import { describe, expect, it } from 'vitest';
import { listUrl, showingRange } from './list-query';

describe('listUrl', () => {
	const filters = { collector: 'c1', buyer: 'Pérez & Hijos', paymentMode: '', status: null };

	it('is the bare list when no filter is applied', () => {
		expect(listUrl('/campaigns/x/sales', { collector: '', buyer: undefined })).toBe(
			'/campaigns/x/sales'
		);
	});
	it('keeps every applied filter, encoded, and leaves the empty ones out', () => {
		expect(listUrl('/campaigns/x/sales', filters)).toBe(
			'/campaigns/x/sales?collector=c1&buyer=P%C3%A9rez%20%26%20Hijos'
		);
	});
	it('adds the page from the second one on, after the filters', () => {
		expect(listUrl('/list', filters, { page: 1 })).toBe(
			'/list?collector=c1&buyer=P%C3%A9rez%20%26%20Hijos'
		);
		expect(listUrl('/list', filters, { page: 3 })).toBe(
			'/list?collector=c1&buyer=P%C3%A9rez%20%26%20Hijos&page=3'
		);
		expect(listUrl('/list', {}, { page: 2 })).toBe('/list?page=2');
	});
	it('drops one filter and keeps the others, back on the first page', () => {
		expect(listUrl('/list', filters, { without: 'buyer' })).toBe('/list?collector=c1');
		expect(listUrl('/list', { status: 'open' }, { without: 'status' })).toBe('/list');
	});
});

describe('showingRange', () => {
	const noun = { one: 'venta', many: 'ventas' };
	it('names the rows of the page and the total', () => {
		expect(showingRange({ page: 2, pageSize: 25, total: 147 }, noun)).toBe(
			'Mostrando 26–50 de 147 ventas'
		);
	});
	it('stops at the total on the last page and groups thousands', () => {
		expect(showingRange({ page: 49, pageSize: 25, total: 1201 }, noun)).toBe(
			'Mostrando 1.201–1.201 de 1.201 ventas'
		);
	});
	it('uses the singular for one row', () => {
		expect(showingRange({ page: 1, pageSize: 25, total: 1 }, noun)).toBe(
			'Mostrando 1–1 de 1 venta'
		);
	});
});

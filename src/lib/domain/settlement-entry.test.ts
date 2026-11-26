import { describe, expect, it } from 'vitest';
import {
	UNREADABLE_BUYER,
	bondQueryNumber,
	cashToHandOverCents,
	findSalesByBondNumber,
	groupCandidatesBySale,
	installmentsLabel,
	selectedTotalCents,
	type PaymentCandidate
} from './settlement-entry';

const candidate = (over: Partial<PaymentCandidate>): PaymentCandidate => ({
	id: 'i1',
	saleId: 's1',
	bond: '0024',
	buyer: 'Verónica Pérez',
	dueDate: '2026-09-09',
	amount: '10000.00',
	status: 'pending',
	number: 3,
	...over
});

const candidates = [
	candidate({ id: 'a4', number: 4, status: 'overdue' }),
	candidate({ id: 'a3', number: 3, status: 'overdue', amount: '4000.50' }),
	candidate({ id: 'b1', saleId: 's2', bond: '0240', buyer: 'Daniel Luna', number: 1 }),
	candidate({ id: 'a5', number: 5 })
];

describe('groupCandidatesBySale', () => {
	it('groups installments by sale, in installment order, with the debt and what is overdue', () => {
		const [first, second] = groupCandidatesBySale(candidates);
		expect(first.installments.map((i) => i.number)).toEqual([3, 4, 5]);
		expect(first.debtCents).toBe(2_400_050);
		expect(first.overdueCents).toBe(1_400_050);
		expect(first.buyer).toBe('Verónica Pérez');
		expect(second).toMatchObject({ saleId: 's2', bond: '0240', debtCents: 1_000_000 });
	});

	it('has no buyer when the role cannot read it', () => {
		const [sale] = groupCandidatesBySale([candidate({ buyer: UNREADABLE_BUYER })]);
		expect(sale.buyer).toBeNull();
	});
});

describe('findSalesByBondNumber', () => {
	const sales = groupCandidatesBySale(candidates);

	it.each(['24', '0024', ' 24 ', 'n.º 24', '000024'])('finds bond 0024 from «%s»', (query) => {
		expect(findSalesByBondNumber(sales, query).map((s) => s.saleId)).toEqual(['s1']);
	});

	it('matches the whole number, never a part of it', () => {
		// 24 is not 240, and 2 is neither.
		expect(findSalesByBondNumber(sales, '240').map((s) => s.saleId)).toEqual(['s2']);
		expect(findSalesByBondNumber(sales, '2')).toEqual([]);
		expect(findSalesByBondNumber(sales, '4')).toEqual([]);
	});

	it('finds nothing for an empty query or one without digits', () => {
		expect(findSalesByBondNumber(sales, '')).toEqual([]);
		expect(findSalesByBondNumber(sales, 'abc')).toEqual([]);
		expect(bondQueryNumber('abc')).toBeNull();
	});

	it('returns every sale with that number, so the caller can refuse to pick', () => {
		const twice = groupCandidatesBySale([candidate({}), candidate({ id: 'x', saleId: 's9' })]);
		expect(findSalesByBondNumber(twice, '24')).toHaveLength(2);
	});

	it('reads a bond with more than one base number', () => {
		const double = groupCandidatesBySale([candidate({ bond: '0024, 0025' })]);
		expect(findSalesByBondNumber(double, '25')).toHaveLength(1);
	});
});

describe('installmentsLabel', () => {
	it('names one, two or more installments in order', () => {
		expect(installmentsLabel([])).toBe('');
		expect(installmentsLabel([4])).toBe('Cuota 4');
		expect(installmentsLabel([3, 2])).toBe('Cuotas 2 y 3');
		expect(installmentsLabel([3, 1, 2])).toBe('Cuotas 1, 2 y 3');
	});
});

describe('selectedTotalCents', () => {
	const [sale] = groupCandidatesBySale(candidates);

	it('adds the checked installments in cents', () => {
		expect(selectedTotalCents(sale.installments, { a3: true, a5: true }, {})).toBe(1_400_050);
		expect(selectedTotalCents(sale.installments, {}, {})).toBe(0);
	});

	it('uses the amount that was typed, and zero for one that is not a number', () => {
		expect(selectedTotalCents(sale.installments, { a4: true }, { a4: '2500,50' })).toBe(250_050);
		expect(selectedTotalCents(sale.installments, { a4: true }, { a4: 'x' })).toBe(0);
	});
});

describe('cashToHandOverCents', () => {
	it('is the cash less the commission kept from it; transfers are not part of it', () => {
		expect(cashToHandOverCents({ totalCash: '70000.00', commissionPaidAmount: '7000.00' })).toBe(
			6_300_000
		);
	});

	it('is never negative', () => {
		expect(cashToHandOverCents({ totalCash: '0.00', commissionPaidAmount: '500.00' })).toBe(0);
	});
});

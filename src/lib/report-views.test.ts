import { describe, expect, it } from 'vitest';
import {
	FINANCIAL_VIEWS,
	OPERATIONAL_VIEWS,
	reportHref,
	reportPage,
	reportView
} from './report-views';

describe('report URLs', () => {
	it('accepts legacy and invalid URLs with a useful default', () => {
		expect(reportView(new URLSearchParams(), OPERATIONAL_VIEWS)).toBe('by-status');
		expect(reportView(new URLSearchParams('view=unknown'), FINANCIAL_VIEWS)).toBe('payments');
		expect(reportView(new URLSearchParams('collector=a'), FINANCIAL_VIEWS, 'ledger')).toBe(
			'ledger'
		);
		expect(reportView(new URLSearchParams('view=roster'), FINANCIAL_VIEWS)).toBe('roster');
	});
	it('keeps every filter when switching views or pages, without an export pagination filter', () => {
		const href = reportHref(
			'/reports',
			{
				collector: 'a',
				from: '2026-11-01',
				method: 'cash',
				draw: 'b',
				eligibility: 'ineligible',
				prize: 'delivered',
				empty: null
			},
			'ledger',
			3
		);
		expect(new URL(href, 'http://local').searchParams).toEqual(
			new URLSearchParams(
				'collector=a&from=2026-11-01&method=cash&draw=b&eligibility=ineligible&prize=delivered&view=ledger&page=3'
			)
		);
		expect(reportHref('/reports', { collector: 'a' }, 'payments')).toBe(
			'/reports?collector=a&view=payments'
		);
	});
	it.each([null, '-1', '0', '1.5', 'Infinity', '9007199254740992', 'nope'])(
		'bounds page %s',
		(page) => expect(reportPage(page)).toBe(1)
	);
});

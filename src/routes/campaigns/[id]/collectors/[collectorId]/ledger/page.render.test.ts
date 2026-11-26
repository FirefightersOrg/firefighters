import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';
import { mapCampaignRow } from '$lib/server/repositories/campaigns';
import { CAMPAIGN_ID, campaignRow } from '../../../../test-helpers';

const COLLECTOR_ID = 'c0000000-0000-0000-0000-000000000001';

interface Entry {
	id: string;
	occurredAt: string;
	entryType: string;
	direction: string;
	amount: number;
	status: string;
	settlementId: string | null;
	paymentId: string | null;
	reason: string | null;
	annulReason?: string;
	runningBalance: number;
	affectsBalance?: boolean;
	originalEntryId?: string | null;
	hasCompensations?: boolean;
}

const entries: Entry[] = [
	{
		id: 'e1',
		occurredAt: '2026-11-19T10:00:00Z',
		entryType: 'commission_generated',
		direction: 'collector_credit',
		amount: 15,
		status: 'recorded',
		settlementId: 's0000000-0000-4000-8000-000000000001',
		paymentId: null,
		reason: null,
		runningBalance: 15
	},
	{
		id: 'e2',
		occurredAt: '2026-11-19T11:00:00Z',
		entryType: 'adjustment_in_favor_of_firefighters',
		direction: 'collector_debit',
		amount: 4,
		status: 'annulled',
		settlementId: null,
		paymentId: null,
		reason: 'Cash shortfall',
		annulReason: 'Entered twice',
		runningBalance: 15
	},
	{
		id: 'e3',
		occurredAt: '2026-11-19T12:00:00Z',
		entryType: 'adjustment_in_favor_of_collector',
		direction: 'collector_credit',
		amount: 2.5,
		status: 'recorded',
		settlementId: null,
		paymentId: null,
		reason: 'Bonus',
		runningBalance: 17.5
	}
];

function page(
	can = { adjustCommission: false, adjustLedger: false },
	list: Entry[] = entries,
	compensable: { id: string; direction: string; label: string }[] = []
) {
	return render(Page, {
		props: {
			data: {
				campaign: mapCampaignRow(campaignRow()),
				collector: { id: COLLECTOR_ID, displayName: 'Ada Collector' },
				entries: list.map((e) => ({
					affectsBalance: true,
					originalEntryId: null,
					hasCompensations: false,
					remaining: e.amount,
					...e
				})),
				compensable,
				balance: list.length ? list[list.length - 1].runningBalance : 0,
				reasonMax: 1000,
				can
			},
			form: null,
			params: { id: CAMPAIGN_ID, collectorId: COLLECTOR_ID }
		} as never
	}).body;
}

describe('collector current account page', () => {
	it('renders every required column, the running balance and the total', () => {
		const body = page();
		for (const column of [
			'Fecha',
			'Tipo',
			'Origen',
			'Rendición',
			'Pago',
			'Débito',
			'Crédito',
			'Saldo',
			'Estado'
		])
			expect(body).toMatch(new RegExp(`>\\s*${column}\\s*</th>`));
		expect(body).toContain('Comisión generada');
		expect(body).toContain('Ajuste a favor de Bomberos');
		expect(body).toMatch(/data-testid="ledger-balance"[\s\S]*\$.17,50/);
		expect(body).toContain('19/11/2026');
		expect(body).toContain(
			`/campaigns/${CAMPAIGN_ID}/settlements/s0000000-0000-4000-8000-000000000001`
		);
	});

	it('shows annulled adjustments struck through with both original and annulment reasons', () => {
		const body = page();
		expect(body).toContain('Anulado');
		expect(body).toContain('Entered twice');
		expect(body).toContain('Cash shortfall');
		expect(body).toContain('Motivo de la anulación: Entered twice');
		expect(body).toContain('line-through');
	});

	it('hides adjustment forms and annul actions without permissions', () => {
		const body = page();
		expect(body).not.toContain('?/adjustCommission');
		expect(body).not.toContain('?/adjustLedger');
		expect(body).not.toContain('?/annul');
	});

	it('shows forms and annul only for recorded entries without a settlement', () => {
		const body = page({ adjustCommission: true, adjustLedger: true });
		expect(body).toContain('?/adjustCommission');
		expect(body).toContain('?/adjustLedger');
		expect(body.match(/data-annul=/g)?.length).toBe(1);
		expect(body).toContain('action="?/annul"');
		expect(body).toContain('name="reason"');
	});

	it('renders an empty state', () => {
		expect(page(undefined, [])).toContain('Todavía no hay movimientos');
	});

	// SAN-107 / SAN-108
	it('marks reference entries, shows what an adjustment compensates and offers compensable entries', () => {
		const list: Entry[] = [
			entries[0],
			{
				...entries[0],
				id: 'memo',
				entryType: 'cash_settled',
				amount: 200,
				affectsBalance: false,
				runningBalance: 15
			},
			{ ...entries[2], hasCompensations: true },
			{
				...entries[2],
				id: 'e4',
				entryType: 'adjustment_in_favor_of_firefighters',
				direction: 'collector_debit',
				amount: 1,
				reason: 'Bonus was lower',
				originalEntryId: 'e3',
				runningBalance: 16.5
			}
		];
		const body = page({ adjustCommission: false, adjustLedger: true }, list, [
			{
				id: 'e3',
				direction: 'collector_credit',
				label: '19/11/2026 · Ajuste a favor del cobrador (queda $ 1,50)'
			},
			{
				id: 'e5',
				direction: 'collector_debit',
				label: '20/11/2026 · Ajuste a favor de Bomberos (queda $ 2,00)'
			}
		]);
		expect(body).toContain('Efectivo rendido');
		expect(body).toContain('Referencia: no cambia el saldo.');
		expect(body).toMatch(/Compensa: Ajuste a favor del cobrador del 19\/11\/2026/);
		expect(body).toContain('name="originalEntryId"');
		// The default adjustment is a credit, so only debits are offered to compensate (#130).
		expect(body).toContain('(queda $ 2,00)');
		expect(body).not.toContain('(queda $ 1,50)');
		// Entries linked to a compensation are corrected with another adjustment, never annulled.
		expect(body.match(/data-annul=/g)).toBeNull();
	});
});

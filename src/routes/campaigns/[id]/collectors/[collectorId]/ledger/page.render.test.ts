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
	compensable: { id: string; direction: string; label: string }[] = [],
	form: unknown = null
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
			form,
			params: { id: CAMPAIGN_ID, collectorId: COLLECTOR_ID }
		} as never
	}).body.replace(/\u00a0/g, ' ');
}
/** The text of a piece of the page, without tags, comments or runs of spaces. */
const textOf = (html: string) =>
	html
		.replace(/<!--.*?-->/g, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
/** The sheet over the movements: label and amount of each row, in order. */
const sheet = (body: string) =>
	[
		.../<div data-testid="ledger-balance">([\s\S]*?)<\/dl>/
			.exec(body)![1]
			.matchAll(/data-kind="(\w+)"><dt[^>]*>([^<]*)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g)
	].map(([, kind, label, value]) => [kind, label, textOf(value)]);

describe('collector current account page', () => {
	it('leads with the balance in words, as a sheet whose rows add up to it', () => {
		const body = page();
		expect(body).toContain('Cuenta corriente de Ada Collector');
		expect(sheet(body)).toEqual([
			['line', 'Comisiones generadas', '$ 15,00'],
			['line', 'Ajustes a favor del cobrador', '$ 2,50'],
			['lead', 'Saldo a favor del cobrador', '$ 17,50']
		]);
		// The sheet comes before the movements.
		expect(body.indexOf('data-testid="ledger-balance"')).toBeLessThan(body.indexOf('<table'));
	});

	it('says a balance against the collector is in favour of Bomberos, without a minus sign', () => {
		const body = page(undefined, [
			entries[0],
			{
				...entries[1],
				id: 'd1',
				status: 'recorded',
				amount: 40,
				annulReason: undefined,
				runningBalance: -25
			}
		]);
		expect(sheet(body)).toEqual([
			['line', 'Comisiones generadas', '$ 15,00'],
			['deduction', 'Ajustes a favor de Bomberos', '− menos $ 40,00'],
			['lead', 'Saldo a favor de Bomberos', '$ 25,00']
		]);
		expect(textOf(body)).toContain('Un importe con signo menos es a favor de Bomberos.');
	});

	it('shows the balance alone if the movements did not add up to it', () => {
		const body = page(undefined, [{ ...entries[0], runningBalance: 99 }]);
		expect(sheet(body)).toEqual([['lead', 'Saldo a favor del cobrador', '$ 99,00']]);
		const against = page(undefined, [{ ...entries[0], runningBalance: -99 }]);
		expect(sheet(against)).toEqual([['lead', 'Saldo a favor de Bomberos', '$ 99,00']]);
	});

	it('lists the movements newest first, each with its signed amount and the running balance', () => {
		const body = page();
		for (const column of ['Fecha', 'Movimiento', 'Importe', 'Saldo'])
			expect(body).toMatch(new RegExp(`>\\s*${column}\\s*</th>`));
		expect(body).not.toMatch(/>\s*Acciones\s*<\/th>/);
		const rows = body.split('<tr role="row"').slice(2).map(textOf);
		expect(rows).toHaveLength(3);
		expect(rows[0]).toContain('Ajuste a favor del cobrador');
		expect(rows[0]).toContain('Motivo: Bonus');
		expect(rows[0]).toMatch(/\$ 2,50 .*\$ 17,50/);
		expect(rows[2]).toContain('Comisión generada');
		expect(rows[2]).toContain('19/11/2026');
		expect(body).toContain(
			`/campaigns/${CAMPAIGN_ID}/settlements/s0000000-0000-4000-8000-000000000001`
		);
		expect(body).toContain('Ver la rendición');
		// A movement that counts says nothing about its state; only the others carry a badge.
		expect(body).not.toContain('Registrado');
	});

	it('shows annulled adjustments struck through with both original and annulment reasons', () => {
		const body = page();
		expect(body).toContain('Anulado');
		expect(body).toContain('Motivo: Cash shortfall');
		expect(body).toContain('Motivo de la anulación: Entered twice');
		expect(body).toContain('line-through');
		// A debit is shown with its sign, read as «menos».
		expect(body).toMatch(/line-through" data-money="">[\s\S]{0,120}menos[\s\S]{0,40}\$ 4,00/);
	});

	it('hides adjustment forms and annul actions without permissions', () => {
		const body = page();
		expect(body).not.toContain('?/adjustCommission');
		expect(body).not.toContain('?/adjustLedger');
		expect(body).not.toContain('?/annul');
		expect(body).not.toContain('Ajustes manuales');
	});

	it('shows the forms collapsed, and annul only for recorded entries without a settlement', () => {
		const body = page({ adjustCommission: true, adjustLedger: true });
		expect(body).toContain('Ajustar una comisión');
		expect(body).toContain('Ajustar la cuenta corriente');
		expect(body).toContain('?/adjustCommission');
		expect(body).toContain('?/adjustLedger');
		for (const id of ['ledger-direction', 'ledger-original', 'ledger-amount', 'ledger-reason'])
			expect(body).toContain(`id="${id}"`);
		expect(body.match(/Registrar ajuste/g)).toHaveLength(2);
		expect(body).not.toMatch(/<details[^>]*\sopen/);
		expect(body.match(/data-annul=/g)?.length).toBe(1);
		expect(body).toContain('action="?/annul"');
		expect(body).toContain('name="entryId"');
		expect(body).toContain('name="reason"');
	});

	it('opens the form the server answered about', () => {
		const body = page({ adjustCommission: true, adjustLedger: true }, entries, [], {
			form: 'ledger',
			success: false,
			message: 'Revisar el ajuste.',
			errors: { amount: ['Ingresar un monto positivo con hasta 2 decimales.'] }
		});
		expect(body.match(/<details[^>]*\sopen/g)).toHaveLength(1);
		expect(body).toMatch(/<details[^>]*\sopen[\s\S]*Ajustar la cuenta corriente/);
		expect(body).toContain('Ingresar un monto positivo con hasta 2 decimales.');
	});

	it('says an annulment was done, or why it was not', () => {
		const done = page({ adjustCommission: false, adjustLedger: true }, entries, [], {
			form: 'annul',
			success: true,
			message: 'Movimiento anulado.'
		});
		expect(done).toMatch(/role="status"[\s\S]*Movimiento anulado\./);
		const failed = page({ adjustCommission: false, adjustLedger: true }, entries, [], {
			form: 'annul',
			success: false,
			message: 'El movimiento ya estaba anulado.'
		});
		expect(failed).toMatch(/role="alert"[\s\S]*El movimiento ya estaba anulado\./);
	});

	it('renders an empty state and no balance to speak of', () => {
		const body = page(undefined, []);
		expect(body).toContain('Todavía no hay movimientos');
		expect(sheet(body)).toEqual([['lead', 'Sin saldo', '$ 0,00']]);
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
		// The reference amount is under the sheet, not one of its terms.
		expect(sheet(body)).toEqual([
			['line', 'Comisiones generadas', '$ 15,00'],
			['line', 'Ajustes a favor del cobrador', '$ 2,50'],
			['deduction', 'Ajustes a favor de Bomberos', '− menos $ 1,00'],
			['lead', 'Saldo a favor del cobrador', '$ 16,50']
		]);
		expect(textOf(body)).toContain('Efectivo rendido $ 200,00');
		expect(body).toMatch(/Compensa: Ajuste a favor del cobrador del 19\/11\/2026/);
		expect(body).toContain('name="originalEntryId"');
		// The default adjustment is a credit, so only debits are offered to compensate (#130).
		expect(body).toContain('(queda $ 2,00)');
		expect(body).not.toContain('(queda $ 1,50)');
		// Entries linked to a compensation are corrected with another adjustment, never annulled.
		expect(body.match(/data-annul=/g)).toBeNull();
	});
});

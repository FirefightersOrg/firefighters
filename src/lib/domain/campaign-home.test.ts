import { describe, expect, it } from 'vitest';
import { balanceWords, homeTasks, wholePesos, type HomeTasksInput } from './campaign-home';
import type { NextDraw } from './dashboard';

const plain = (value: string) => value.replace(/\u00a0/g, ' ');
const NOW = new Date('2026-11-26T15:00:00-03:00');
const draw = (extra: Partial<NextDraw> = {}): NextDraw => ({
	id: 'd1',
	name: 'Sorteo de noviembre',
	type: 'monthly',
	drawDate: '2026-12-07',
	paymentCutoffAt: '2026-12-05T23:59:00-03:00',
	requiredInstallmentNumber: 2,
	status: 'scheduled',
	atRiskCount: 8,
	...extra
});
const submitted = (
	rows: { name: string; count: number; amount: string; settlement: string | null }[]
) => ({
	count: rows.reduce((n, row) => n + row.count, 0),
	amount: '0.00',
	byCollector: rows.map((row, i) => ({
		collectorId: `c${i + 1}`,
		collectorName: row.name,
		count: row.count,
		amount: row.amount,
		openSettlementId: row.settlement
	}))
});
const input = (extra: Partial<HomeTasksInput> = {}): HomeTasksInput => ({
	submitted: null,
	nextDraw: null,
	openSettlements: null,
	can: { viewSettlements: true, openSettlement: true },
	now: NOW,
	...extra
});

describe('homeTasks', () => {
	it('is empty when nothing waits', () => {
		expect(homeTasks(input())).toEqual([]);
		expect(
			homeTasks(
				input({
					submitted: submitted([]),
					nextDraw: draw({ atRiskCount: 0 }),
					openSettlements: 0
				})
			)
		).toEqual([]);
	});

	it('names each collector with submitted payments and leads to their open settlement', () => {
		const [task] = homeTasks(
			input({
				submitted: submitted([
					{ name: 'Jorge Medina', count: 1, amount: '10000.00', settlement: 's1' }
				])
			})
		);
		expect(task.title).toBe('1 cobro enviado por Jorge Medina sin procesar');
		expect(plain(task.detail)).toBe(
			'$ 10.000. Su rendición no se puede cerrar hasta incluirlo o rechazarlo.'
		);
		expect(task.target).toEqual({ kind: 'settlement', settlementId: 's1' });
		expect(task.action).toBe('Abrir la rendición');
	});

	it('agrees in number, and rounds the amount to whole pesos', () => {
		const [task] = homeTasks(
			input({
				submitted: submitted([{ name: 'Ana', count: 3, amount: '30000.50', settlement: 's1' }])
			})
		);
		expect(task.title).toBe('3 cobros enviados por Ana sin procesar');
		expect(plain(task.detail)).toBe(
			'$ 30.001. Su rendición no se puede cerrar hasta incluirlos o rechazarlos.'
		);
	});

	it('opens a settlement for a collector that has none, when the role may', () => {
		const rows = submitted([{ name: 'Beto', count: 1, amount: '5000.00', settlement: null }]);
		const [may] = homeTasks(input({ submitted: rows }));
		expect(plain(may.detail)).toBe(
			'$ 5.000. No tiene una rendición abierta: hace falta una para incluirlo o rechazarlo.'
		);
		expect(may.target).toEqual({ kind: 'new-settlement', collectorId: 'c1' });
		expect(may.action).toBe('Abrir una rendición');
		const [mayNot] = homeTasks(
			input({ submitted: rows, can: { viewSettlements: true, openSettlement: false } })
		);
		expect(mayNot.target).toEqual({ kind: 'open-settlements' });
		expect(mayNot.action).toBe('Ver rendiciones');
	});

	it('tells a role that does not see settlements, without a target', () => {
		const tasks = homeTasks(
			input({
				submitted: submitted([{ name: 'Ana', count: 2, amount: '100.00', settlement: 's1' }]),
				openSettlements: 4,
				can: { viewSettlements: false, openSettlement: false }
			})
		);
		expect(tasks).toHaveLength(1);
		expect(tasks[0].target).toBeNull();
		expect(plain(tasks[0].detail)).toBe('$ 100. Se incluyen o se rechazan desde su rendición.');
	});

	it('warns before the cutoff that bonds may miss the draw, with the days left', () => {
		const [task] = homeTasks(input({ nextDraw: draw() }));
		expect(task.title).toBe('8 bonos vendidos pueden quedar fuera de «Sorteo de noviembre»');
		expect(task.detail).toBe(
			'El sorteo exige la cuota 2 paga. El corte es el 05/12/2026, 23:59: faltan 9 días.'
		);
		expect(task.target).toEqual({ kind: 'at-risk-bonds' });
		expect(task.action).toBe('Ver los bonos');
	});

	it.each([
		['2026-12-04T10:00:00-03:00', 'El corte es el 05/12/2026, 23:59: falta 1 día.'],
		['2026-12-05T10:00:00-03:00', 'El corte es hoy, 05/12/2026, 23:59.']
	])('counts the days to the cutoff from %s', (now, when) => {
		const [task] = homeTasks(input({ nextDraw: draw(), now: new Date(now) }));
		expect(task.detail).toContain(when);
	});

	it('says the bonds are out once the cutoff passed or the roster is frozen', () => {
		const [passed] = homeTasks(
			input({ nextDraw: draw(), now: new Date('2026-12-06T10:00:00-03:00') })
		);
		expect(passed.title).toBe('8 bonos vendidos no entran en «Sorteo de noviembre»');
		expect(passed.detail).toBe(
			'El sorteo exige la cuota 2 paga. El corte fue el 05/12/2026, 23:59.'
		);
		const [frozen] = homeTasks(input({ nextDraw: draw({ status: 'roster_frozen' }) }));
		expect(frozen.title).toContain('no entran en');
	});

	it('agrees in number for one bond and names a draw that asks for the full payment', () => {
		const [task] = homeTasks(
			input({ nextDraw: draw({ atRiskCount: 1, requiredInstallmentNumber: null }) })
		);
		expect(task.title).toBe('1 bono vendido puede quedar fuera de «Sorteo de noviembre»');
		expect(task.detail).toContain('El sorteo exige el pago total.');
		expect(task.action).toBe('Ver el bono');
	});

	it('counts the open settlements, last', () => {
		const tasks = homeTasks(
			input({
				submitted: submitted([{ name: 'Ana', count: 1, amount: '100.00', settlement: 's1' }]),
				nextDraw: draw(),
				openSettlements: 3
			})
		);
		expect(tasks.map((task) => task.key)).toEqual(['submitted-c1', 'draw-d1', 'open-settlements']);
		expect(tasks[2]).toMatchObject({
			title: '3 rendiciones abiertas',
			detail: 'Sus pagos quedan confirmados cuando se cierran.',
			target: { kind: 'open-settlements' },
			action: 'Ver rendiciones'
		});
		const [one] = homeTasks(input({ openSettlements: 1 }));
		expect(one).toMatchObject({
			title: '1 rendición abierta',
			detail: 'Sus pagos quedan confirmados cuando se cierra.',
			action: 'Ver la rendición'
		});
	});
});

describe('balanceWords', () => {
	it('gives the amount without a sign and says who owes', () => {
		expect(balanceWords('41000.00')).toEqual({ amount: '41000.00', owes: false });
		expect(balanceWords('-20.50')).toEqual({ amount: '20.50', owes: true });
	});
	it('is null for a zero balance', () => {
		expect(balanceWords('0.00')).toBeNull();
		expect(balanceWords('-0.00')).toBeNull();
	});
});

describe('wholePesos', () => {
	it.each([
		['1500.00', '1500.00'],
		['1500.49', '1500.00'],
		['1500.50', '1501.00'],
		['0.49', '0.00'],
		['-20.50', '-21.00'],
		['-0.40', '0.00']
	])('rounds %s to %s', (value, rounded) => {
		expect(wholePesos(value)).toBe(rounded);
	});
	it('returns what is not an amount as given', () => {
		expect(wholePesos('—')).toBe('—');
	});
});

import { describe, expect, it } from 'vitest';
import { countDrawPrizes, drawProgress, type DrawPrizeCounts } from './draw-steps';

const at = '24/11/2026, 10:02';
const counts = (extra: Partial<DrawPrizeCounts> = {}): DrawPrizeCounts => ({
	total: 0,
	unresolved: 0,
	resolved: 0,
	pendingDelivery: 0,
	...extra
});
const progress = (
	status: Parameters<typeof drawProgress>[0]['status'],
	prizes: DrawPrizeCounts | null = counts()
) =>
	drawProgress({
		status,
		rosterGeneratedAt: status === 'scheduled' ? null : at,
		rosterFrozenAt: ['scheduled', 'roster_generated'].includes(status) ? null : at,
		prizes
	});
const states = (result: ReturnType<typeof drawProgress>) => result.steps.map((step) => step.state);

describe('countDrawPrizes', () => {
	it('leaves annulled prizes out and tells resolved from waiting', () => {
		expect(
			countDrawPrizes([
				{ status: 'pending_validation' },
				{ status: 'pending_delivery' },
				{ status: 'awarded' },
				{ status: 'delivered' },
				{ status: 'unawarded' },
				{ status: 'annulled' }
			])
		).toEqual({ total: 5, unresolved: 1, resolved: 4, pendingDelivery: 2 });
		expect(countDrawPrizes([])).toEqual(counts());
	});
});

describe('drawProgress', () => {
	it('a scheduled draw: the next step is generating the roster', () => {
		const result = progress('scheduled');
		expect(result.current).toBe('generate');
		expect(states(result)).toEqual(['current', 'pending', 'pending', 'pending']);
		expect(result.steps.map((step) => step.title)).toEqual([
			'Generar el padrón',
			'Congelar el padrón',
			'Cargar los ganadores',
			'Completar el sorteo'
		]);
	});

	it('a generated roster: the next step is freezing it, and it says when it was generated', () => {
		const result = progress('roster_generated', counts({ total: 2, unresolved: 2 }));
		expect(result.current).toBe('freeze');
		expect(states(result)).toEqual(['done', 'current', 'pending', 'pending']);
		expect(result.steps[0].detail).toBe('Generado el 24/11/2026, 10:02.');
		expect(result.steps[1].detail).toContain('se puede volver a generar');
		expect(result.steps[2].detail).toContain('Ya hay 2 premios configurados.');
	});

	it('a frozen roster with no prizes, or with prizes waiting: the next step is the winners', () => {
		const empty = progress('roster_frozen');
		expect(empty.current).toBe('winners');
		expect(empty.readyToComplete).toBe(false);
		expect(states(empty)).toEqual(['done', 'done', 'current', 'pending']);
		expect(empty.steps[1].detail).toBe('Congelado el 24/11/2026, 10:02.');
		expect(empty.steps[2].detail).toContain('Todavía no hay premios configurados.');

		const waiting = progress('roster_frozen', counts({ total: 3, unresolved: 2, resolved: 1 }));
		expect(waiting.current).toBe('winners');
		expect(waiting.readyToComplete).toBe(false);
		expect(waiting.steps[2].detail).toBe('Falta resolver 2 de 3 premios.');
		expect(progress('roster_frozen', counts({ total: 1, unresolved: 1 })).steps[2].detail).toBe(
			'Falta resolver 1 de 1 premio.'
		);
	});

	it('a frozen roster with every prize resolved: the next step is completing the draw', () => {
		const result = progress('roster_frozen', counts({ total: 2, resolved: 2, pendingDelivery: 1 }));
		expect(result.current).toBe('complete');
		expect(result.readyToComplete).toBe(true);
		expect(states(result)).toEqual(['done', 'done', 'done', 'current']);
		expect(result.steps[2].detail).toBe('2 premios resueltos. Falta entregar 1.');
		expect(result.steps[3].detail).toContain('Todos los premios están resueltos.');
	});

	it('prizes that could not be read: the winners stay the next step and completion is not judged', () => {
		const result = progress('roster_frozen', null);
		expect(result.current).toBe('winners');
		expect(result.readyToComplete).toBeNull();
	});

	it('a completed or closed draw has every step done and none next', () => {
		const completed = progress('completed', counts({ total: 1, resolved: 1 }));
		expect(completed.current).toBeNull();
		expect(states(completed)).toEqual(['done', 'done', 'done', 'done']);
		expect(completed.steps[2].detail).toBe('1 premio resuelto.');
		expect(completed.steps[3].detail).toBe('Sorteo realizado.');
		expect(progress('closed').steps[3].detail).toBe('Sorteo cerrado.');
	});

	it('an annulled draw has no steps', () => {
		const result = progress('annulled');
		expect(result.steps).toEqual([]);
		expect(result.current).toBeNull();
	});
});

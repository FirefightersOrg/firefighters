import { describe, expect, it } from 'vitest';
import { BondServiceError } from '$lib/server/services/bonds';
import {
	bondServiceFailure,
	campaignLockedMessage,
	conflictLinks,
	duplicateNumbersFieldMessage,
	withoutBondIds
} from './route-helpers';

const A = 'b0000000-0000-0000-0000-00000000000a';
const B = 'b0000000-0000-0000-0000-00000000000b';
const conflict = (number: number, formatted: string, bondId: string) => ({
	number,
	formatted,
	bondId,
	numberKind: 'base' as const
});

describe('bond route helpers', () => {
	it('words duplicate numbers without bond ids', () => {
		expect(duplicateNumbersFieldMessage([conflict(68, '0068', A)])).toBe(
			'El número 0068 ya está en uso en otro bono de esta campaña.'
		);
		expect(duplicateNumbersFieldMessage([conflict(68, '0068', A), conflict(4939, '4939', A)])).toBe(
			'Los números 0068, 4939 ya están en uso en otro bono de esta campaña.'
		);
		expect(duplicateNumbersFieldMessage([conflict(68, '0068', A), conflict(5000, '5000', B)])).toBe(
			'Los números 0068, 5000 ya están en uso en otros bonos de esta campaña.'
		);
	});

	it('groups conflicts by the bond that uses them', () => {
		expect(
			conflictLinks('baseNumber', [
				conflict(68, '0068', A),
				conflict(5000, '5000', B),
				conflict(4939, '4939', A)
			])
		).toEqual([
			{ field: 'baseNumber', bondId: A, numbers: ['0068', '4939'] },
			{ field: 'baseNumber', bondId: B, numbers: ['5000'] }
		]);
	});

	it('explains the campaign status', () => {
		expect(campaignLockedMessage('annulled')).toMatch(/La campaña está anulada\.$/);
	});

	it('maps form-level service errors and rethrows anything else', () => {
		const result = bondServiceFailure(
			'create',
			new BondServiceError('internal', 'Algo salió mal. Volver a intentar.')
		);
		expect(result.status).toBe(500);
		expect(result.data).toMatchObject({ message: 'Algo salió mal. Volver a intentar.' });
		expect(() => bondServiceFailure('create', new Error('boom'))).toThrow('boom');
	});
});

describe('withoutBondIds', () => {
	it('removes bond ids from database messages', () => {
		expect(withoutBondIds(`El bono 0068 (${A}) ya está anulado.`)).toBe(
			'El bono 0068 ya está anulado.'
		);
		expect(withoutBondIds(`El bono 0068 (${A}) ya pertenece a la pata manual ${B}.`)).toBe(
			'El bono 0068 ya pertenece a una pata manual.'
		);
		expect(
			withoutBondIds(`Solo se puede desagrupar una pata disponible (la pata ${B} está vendida).`)
		).toBe('Solo se puede desagrupar una pata disponible (esta pata está vendida).');
		expect(withoutBondIds(`El bono ${A} figura más de una vez.`)).toBe(
			'Un bono figura más de una vez.'
		);
		expect(withoutBondIds('Nothing to remove.')).toBe('Nothing to remove.');
	});
});

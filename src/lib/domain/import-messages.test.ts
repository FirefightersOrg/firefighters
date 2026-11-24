import { describe, expect, it } from 'vitest';
import { translateImportMessage } from './import-messages';

describe('translateImportMessage', () => {
	it.each([
		[
			'Number 5129 does not fit the campaign (maximum 9999).',
			'El número 5129 no entra en la campaña (máximo 9999).'
		],
		[
			'Base number 0020 is repeated in the import.',
			'El número base 0020 está repetido en la importación.'
		],
		[
			'Barcode LIVE-100 is already used in this campaign.',
			'El código de barras LIVE-100 ya está en uso en esta campaña.'
		],
		[
			'A pata needs at least 2 rows (this group has 1).',
			'Una pata necesita al menos 2 filas (este grupo tiene 1).'
		],
		['The row has no base number.', 'La fila no tiene número base.'],
		[
			'row 3: a simple row cannot have a grupo_pata',
			'Fila 3: una fila de bono simple no puede tener grupo_pata'
		]
	])('translates %j', (english, spanish) => {
		expect(translateImportMessage(english)).toBe(spanish);
	});

	it('returns Spanish and unknown messages unchanged', () => {
		expect(translateImportMessage('La fila no tiene número base.')).toBe(
			'La fila no tiene número base.'
		);
		expect(translateImportMessage('something unexpected')).toBe('something unexpected');
	});
});

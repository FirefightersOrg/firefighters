import { describe, expect, it } from 'vitest';
import { DEFAULT_NUMBERING_CONFIG } from './numbering';
import { previewPata, splitBaseNumbers } from './pata-preview';

const config = DEFAULT_NUMBERING_CONFIG;

describe('splitBaseNumbers', () => {
	it('accepts commas, semicolons and whitespace, ignoring blanks', () => {
		expect(splitBaseNumbers(' 68, 69;70\n\n 0071 ,, ')).toEqual(['68', '69', '70', '0071']);
		expect(splitBaseNumbers('   ')).toEqual([]);
	});
});

describe('previewPata', () => {
	it('pairs every base number, counts N and computes simple_bond_value * N', () => {
		const preview = previewPata('68 69 70', config, '60000.00');
		expect(preview.ok).toBe(true);
		expect(preview.unitCount).toBe(3);
		expect(preview.totalValue).toBe('180000.00');
		expect(
			preview.entries.map((e) =>
				e.preview.state === 'ok' ? [e.preview.baseFormatted, e.preview.associatedFormatted] : null
			)
		).toEqual([
			['0068', '4939'],
			['0069', '4940'],
			['0070', '4941']
		]);
	});

	it('needs at least 2 base numbers', () => {
		expect(previewPata('68', config, '60000.00').problems).toEqual([
			'Una pata necesita al menos 2 números base'
		]);
		expect(previewPata('', config, '60000.00')).toMatchObject({
			ok: false,
			unitCount: 0,
			totalValue: null
		});
	});

	it('reports overflow, range and format problems per number', () => {
		const preview = previewPata('68 5129 12345', config, '60000.00');
		expect(preview.ok).toBe(false);
		expect(preview.problems[0]).toContain('el número base más alto permitido es 5128');
		expect(preview.problems[1]).toContain('no es un número válido');
	});

	it('reports numbers repeated inside the pata', () => {
		expect(previewPata('68 68', config, '60000.00').problems).toEqual([
			'El número 0068 aparece más de una vez en esta pata (2 como base, 0 como asociado)',
			'El número 4939 aparece más de una vez en esta pata (0 como base, 2 como asociado)'
		]);
		expect(previewPata('68 4939', config, '60000.00').collisions.map((c) => c.formatted)).toEqual([
			'4939'
		]);
	});

	it('works for 5-digit campaigns', () => {
		const preview = previewPata(
			'68 69',
			{
				numberDigits: 5,
				maxNumber: 99999,
				associatedNumberOffset: 48710,
				overflowPolicy: 'reject'
			},
			'60000.50'
		);
		expect(preview.entries[0].preview).toMatchObject({
			baseFormatted: '00068',
			associatedFormatted: '48778'
		});
		expect(preview.totalValue).toBe('120001.00');
	});
});

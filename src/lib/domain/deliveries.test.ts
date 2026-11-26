import { describe, expect, it } from 'vitest';
import { deliveryNoteLabel, deliveryNoteParty } from './deliveries';

describe('delivery note names', () => {
	it('pads the note number to four digits', () => {
		expect(deliveryNoteLabel(7)).toBe('Remito 0007');
		expect(deliveryNoteLabel(12345)).toBe('Remito 12345');
	});
	it('says who the bonds go to, or who they come back from', () => {
		expect(deliveryNoteParty('delivery', 'Jorge Medina')).toBe('a Jorge Medina');
		expect(deliveryNoteParty('reassignment', 'Héctor Acosta')).toBe('a Héctor Acosta');
		expect(deliveryNoteParty('return', 'Lucía Fernández')).toBe('de Lucía Fernández');
	});
	it('leaves the name out when the role cannot read the collector', () => {
		expect(deliveryNoteParty('delivery', null)).toBe('');
		expect(deliveryNoteParty('return', '')).toBe('');
	});
});

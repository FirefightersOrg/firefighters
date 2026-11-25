import { describe, expect, it } from 'vitest';
import { submissionStatusLabel, submissionStatusTone, SUBMISSION_STATUS } from './labels';

describe('submission status labels', () => {
	it('maps each payment status to the collector wording', () => {
		expect(submissionStatusLabel('draft')).toBe('Enviado');
		expect(submissionStatusLabel('pending_in_settlement')).toBe('En rendición');
		expect(submissionStatusLabel('confirmed')).toBe('Confirmado');
		expect(submissionStatusLabel('adjusted')).toBe('Confirmado');
		expect(submissionStatusLabel('annulled')).toBe('Rechazado');
	});

	it('gives Enviado and En rendición different words and tones', () => {
		expect(submissionStatusLabel('draft')).not.toBe(submissionStatusLabel('pending_in_settlement'));
		expect(submissionStatusTone('draft')).not.toBe(submissionStatusTone('pending_in_settlement'));
		expect(submissionStatusTone('confirmed')).toBe('success');
		expect(submissionStatusTone('annulled')).toBe('danger');
	});

	it('falls back to Enviado for an unknown status', () => {
		expect(submissionStatusLabel('whatever')).toBe('Enviado');
		expect(Object.keys(SUBMISSION_STATUS)).toHaveLength(5);
	});
});

/**
 * Shared UI messages (docs/copy.md: impersonal, say what happened and what to do). Client-safe.
 */

/** Fallback for unexpected failures, when there is nothing more specific to tell. */
export const GENERIC_ERROR_MESSAGE = 'Algo salió mal. Volver a intentar.';

/**
 * A settlement cannot be closed while its collector has submitted collections nobody has processed (SAN-156).
 * Says what happened and what to do; singular and plural agree with the count.
 */
export function unprocessedSubmittedMessage(count: number): string {
	return count === 1
		? 'Hay 1 cobro enviado por el cobrador sin procesar. Inclúyalo o recházalo antes de cerrar la rendición.'
		: `Hay ${count} cobros enviados por el cobrador sin procesar. Inclúyalos o recházalos antes de cerrar la rendición.`;
}

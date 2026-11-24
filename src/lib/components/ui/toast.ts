/** A toast with an action stays until dismissed; one without disappears after 5 s. */
export const TOAST_TIMEOUT_MS = 5000;

export function toastTimeout(hasAction: boolean): number | null {
	return hasAction ? null : TOAST_TIMEOUT_MS;
}

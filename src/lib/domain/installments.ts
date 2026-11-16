/**
 * Installment rule (pure domain logic).
 *
 * `installment_value = simple_bond_value / installment_count` and the division must be exact to
 * the cent: 60000 in 10 installments is 6000 each; 60000 in 7 installments is rejected instead of
 * rounded (product decision, enforced again by `campaign_installment_value()` and the
 * `campaigns_installment_value_exact` CHECK in the database).
 */
import { centsToDecimalString, formatMoney, parseMoneyToCents } from './money';

export type InstallmentSplit =
	| { ok: true; installmentValueCents: number }
	| { ok: false; reason: 'invalid_total' | 'invalid_count' | 'not_exact' };

/** Splits a total (in cents) into `installmentCount` equal installments, if exact. */
export function splitIntoInstallments(
	totalCents: number,
	installmentCount: number
): InstallmentSplit {
	if (!Number.isSafeInteger(totalCents) || totalCents <= 0) {
		return { ok: false, reason: 'invalid_total' };
	}
	if (!Number.isSafeInteger(installmentCount) || installmentCount <= 0) {
		return { ok: false, reason: 'invalid_count' };
	}
	if (totalCents % installmentCount !== 0) {
		return { ok: false, reason: 'not_exact' };
	}
	return { ok: true, installmentValueCents: totalCents / installmentCount };
}

/** User-facing message for a value that cannot be split exactly. */
export function notExactInstallmentsMessage(simpleBondValue: string, installmentCount: number) {
	return (
		`${formatMoney(simpleBondValue)} cannot be split into ${installmentCount} equal installments. ` +
		'Choose a value and a number of installments that divide exactly (to the cent).'
	);
}

export type InstallmentPreview =
	| { state: 'incomplete' }
	| { state: 'ok'; installmentValue: string }
	| { state: 'error'; message: string };

/**
 * Live preview for raw form input (strings). Used by the campaign forms to show the computed,
 * read-only installment value or an inline error while the user types.
 */
export function previewInstallmentValue(
	simpleBondValue: string,
	installmentCount: string
): InstallmentPreview {
	const totalRaw = simpleBondValue.trim();
	const countRaw = installmentCount.trim();
	if (totalRaw === '' || countRaw === '') return { state: 'incomplete' };

	const totalCents = parseMoneyToCents(totalRaw);
	if (totalCents === null || totalCents <= 0) {
		return { state: 'error', message: 'Enter a simple bond value greater than 0.' };
	}
	if (!/^\d+$/.test(countRaw) || Number(countRaw) <= 0) {
		return { state: 'error', message: 'Enter a whole number of installments greater than 0.' };
	}

	const count = Number(countRaw);
	const split = splitIntoInstallments(totalCents, count);
	if (!split.ok) {
		return {
			state: 'error',
			message: notExactInstallmentsMessage(centsToDecimalString(totalCents), count)
		};
	}
	return { state: 'ok', installmentValue: centsToDecimalString(split.installmentValueCents) };
}

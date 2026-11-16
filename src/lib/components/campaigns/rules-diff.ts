import { BARCODE_MODE_LABELS, type BarcodeMode, type Campaign } from '$lib/domain/campaigns';
import { previewInstallmentValue } from '$lib/domain/installments';
import { formatCents, formatMoney, parseMoneyInput, parseMoneyToCents } from '$lib/domain/money';
import type { CampaignRulesValues } from './types';

/** One rule that differs between the saved campaign and the form, formatted for display. */
export interface RuleChange {
	field: keyof CampaignRulesValues | 'installmentValue';
	label: string;
	from: string;
	to: string;
}

const EMPTY = '(empty)';

function invalid(raw: string): string {
	return raw.trim() === '' ? EMPTY : `${raw.trim()} (invalid)`;
}

function parseWhole(raw: string): number | null {
	const text = raw.trim();
	return /^\d+$/.test(text) ? Number(text) : null;
}

function barcodeLabel(mode: string): string {
	return BARCODE_MODE_LABELS[mode as BarcodeMode] ?? (mode.trim() === '' ? EMPTY : mode);
}

/**
 * Rule fields whose form value differs from the saved campaign (old → new), in form order.
 * Values are compared by meaning, not text: `60.000,00` equals the stored `60000.00`, `012`
 * equals 12. The calculated installment value is listed when it changes. Unparseable input is
 * shown as typed, marked invalid (the server rejects it on submit).
 */
export function diffCampaignRules(campaign: Campaign, values: CampaignRulesValues): RuleChange[] {
	const changes: RuleChange[] = [];

	const savedCents = parseMoneyToCents(campaign.simpleBondValue);
	const typedCents = parseMoneyInput(values.simpleBondValue);
	if (typedCents !== savedCents) {
		changes.push({
			field: 'simpleBondValue',
			label: 'Simple bond value',
			from: formatMoney(campaign.simpleBondValue),
			to: typedCents === null ? invalid(values.simpleBondValue) : formatCents(typedCents)
		});
	}

	const pushWhole = (
		field: 'installmentCount' | 'numberDigits' | 'maxNumber' | 'associatedNumberOffset',
		label: string,
		saved: number
	) => {
		const typed = parseWhole(values[field]);
		if (typed !== saved) {
			changes.push({
				field,
				label,
				from: String(saved),
				to: typed === null ? invalid(values[field]) : String(typed)
			});
		}
	};

	pushWhole('installmentCount', 'Number of installments', campaign.installmentCount);

	const installment = previewInstallmentValue(values.simpleBondValue, values.installmentCount);
	if (installment.state === 'ok' && installment.installmentValue !== campaign.installmentValue) {
		changes.push({
			field: 'installmentValue',
			label: 'Installment value (calculated)',
			from: formatMoney(campaign.installmentValue),
			to: formatMoney(installment.installmentValue)
		});
	}

	pushWhole('numberDigits', 'Number of digits', campaign.numberDigits);
	pushWhole('maxNumber', 'Maximum number', campaign.maxNumber);
	pushWhole('associatedNumberOffset', 'Associated number offset', campaign.associatedNumberOffset);

	if (values.overflowPolicy.trim() !== campaign.overflowPolicy) {
		changes.push({
			field: 'overflowPolicy',
			label: 'Overflow policy',
			from: campaign.overflowPolicy,
			to: values.overflowPolicy.trim() || EMPTY
		});
	}

	if (values.barcodeMode !== campaign.barcodeMode) {
		changes.push({
			field: 'barcodeMode',
			label: 'Barcode mode',
			from: barcodeLabel(campaign.barcodeMode),
			to: barcodeLabel(values.barcodeMode)
		});
	}

	return changes;
}

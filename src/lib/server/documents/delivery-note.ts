import { env } from '$env/dynamic/public';
import { formatDateTime } from '$lib/format';
import { deliveryNoteLabel, type DeliveryNote } from '$lib/domain/deliveries';
import { formatCampaignNumber } from '$lib/domain/numbering';
import { campaignNumberingConfig } from '$lib/domain/campaigns';
import type { Campaign } from '$lib/domain/campaigns';
import type { DeliveryNoteBond } from '$lib/server/repositories/deliveries';

export interface PrintableDeliveryBond {
	type: 'Simple' | 'Pata';
	numbers: { base: string; associated: string | null; barcode: string | null }[];
	barcode: string | null;
	units: number;
}

/** The 13 fields defined in docs/documents.md for a bond delivery note. */
export interface PrintableDeliveryNote {
	institutionName: string;
	campaign: string;
	deliveryNoteNumber: string;
	reason: DeliveryNote['reason'];
	status: DeliveryNote['status'];
	date: string;
	collector: string;
	registeredBy: string;
	deliveredBonds: PrintableDeliveryBond[];
	type: string;
	baseAndAssociatedNumbers: string[];
	barcode: string[];
	notes: string | null;
	collectorSignature: string;
	administrationSignature: string;
	bondCount: number;
	unitCount: number;
}

function pairs(bond: DeliveryNoteBond, campaign: Campaign) {
	return bond.numbers
		.filter((number) => number.kind === 'base')
		.sort((a, b) => a.value - b.value)
		.map((base) => ({
			base: formatCampaignNumber(base.value, campaignNumberingConfig(campaign)),
			associated: base.sourceBaseNumberId
				? null
				: (() => {
						const associated = bond.numbers.find(
							(number) => number.kind === 'associated' && number.sourceBaseNumberId === base.id
						);
						return associated
							? formatCampaignNumber(associated.value, campaignNumberingConfig(campaign))
							: null;
					})(),
			barcode: base.barcode
		}));
}

function printableBond(bond: DeliveryNoteBond, campaign: Campaign): PrintableDeliveryBond {
	const legs = (bond.members.length ? bond.members : [bond]).toSorted(
		(a, b) =>
			(a.numbers.find((number) => number.kind === 'base')?.value ?? Infinity) -
			(b.numbers.find((number) => number.kind === 'base')?.value ?? Infinity)
	);
	return {
		type: bond.kind === 'simple' ? 'Simple' : 'Pata',
		numbers: legs.flatMap((leg) => pairs(leg, campaign)),
		barcode: bond.barcode,
		units: bond.commercialUnitCount
	};
}

export function buildPrintableDeliveryNote(
	campaign: Campaign,
	note: DeliveryNote,
	bonds: DeliveryNoteBond[],
	institutionName = env.PUBLIC_INSTITUTION_NAME || 'Bomberos Voluntarios'
): PrintableDeliveryNote {
	const deliveredBonds = bonds.map((bond) => printableBond(bond, campaign));
	return {
		institutionName,
		campaign: campaign.name,
		deliveryNoteNumber: deliveryNoteLabel(note.noteNumber),
		reason: note.reason,
		status: note.status,
		// The institution works in Argentina: print the local date of the delivery.
		date: formatDateTime(note.issuedAt),
		collector: note.collectorName ?? 'Collector',
		registeredBy: note.createdByName ?? 'User',
		deliveredBonds,
		type: deliveredBonds.map((bond) => bond.type).join(', '),
		baseAndAssociatedNumbers: deliveredBonds.flatMap((bond) =>
			bond.numbers.map((number) =>
				number.associated ? `${number.base} / ${number.associated}` : number.base
			)
		),
		barcode: deliveredBonds.flatMap((bond) => [
			...(bond.barcode ? [bond.barcode] : []),
			...bond.numbers.flatMap((number) => (number.barcode ? [number.barcode] : []))
		]),
		notes: note.notes,
		collectorSignature: 'Collector signature',
		administrationSignature: 'Administration signature',
		bondCount: deliveredBonds.length,
		unitCount: deliveredBonds.reduce((total, bond) => total + bond.units, 0)
	};
}

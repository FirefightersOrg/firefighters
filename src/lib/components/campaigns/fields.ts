/** Field names, labels and control ids of the campaign forms, in page order (error summary links). */
export interface FormFieldRef {
	name: string;
	label: string;
	id?: string;
}

export const GENERAL_FIELDS: FormFieldRef[] = [
	{ name: 'name', label: 'Nombre' },
	{ name: 'startsOn', label: 'Fecha de inicio' },
	{ name: 'endsOn', label: 'Fecha de fin' }
];

export const RULES_FIELDS: FormFieldRef[] = [
	{ name: 'simpleBondValue', label: 'Valor del bono simple' },
	{ name: 'installmentCount', label: 'Cantidad de cuotas' },
	{ name: 'numberDigits', label: 'Cantidad de dígitos' },
	{ name: 'maxNumber', label: 'Número máximo' },
	{ name: 'associatedNumberMode', label: 'Modo del número asociado' },
	{ name: 'associatedNumberOffset', label: 'Desfase del número asociado' },
	{ name: 'overflowPolicy', label: 'Política de desborde' },
	{ name: 'barcodeMode', label: 'Modo de código de barras' },
	{ name: 'barcodePattern', label: 'Patrón del código de barras' }
];

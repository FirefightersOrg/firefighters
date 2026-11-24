/**
 * Spanish wording (docs/copy.md) of the English messages the import flow produces: the row
 * checks of `interpretImportRow` / `validateImportBatch` (mirrored by the database, which stores
 * them in `import_session_items.error_message`) and the errors the `import_session_*` functions
 * raise. The stored and raised texts stay as they are (the database is the authority and the
 * wording is shared); screens and action results translate them here, on display. A message that
 * is already Spanish, or unknown, is returned unchanged.
 */

const PATTERNS: [RegExp, (m: RegExpExecArray) => string][] = [
	// Row checks (domain + database)
	[
		/^The row does not say whether it is a simple bond or a pata\.?$/,
		() => 'La fila no indica si es un bono simple o una pata.'
	],
	[/^The row has no base number\.?$/, () => 'La fila no tiene número base.'],
	[
		/^Every row of a pata needs its barcode\.?$/,
		() => 'Todas las filas de una pata necesitan su código de barras.'
	],
	[
		/^Every row of a pata needs its grupo_pata\.?$/,
		() => 'Todas las filas de una pata necesitan su grupo_pata.'
	],
	[
		/^Number (\S+) does not fit the campaign \(maximum (\S+)\)\.?$/,
		(m) => `El número ${m[1]} no entra en la campaña (máximo ${m[2]}).`
	],
	[
		/^Base number (\S+) is repeated in the import\.?$/,
		(m) => `El número base ${m[1]} está repetido en la importación.`
	],
	[
		/^This number \(or its associated number\) is repeated in the import\.?$/,
		() => 'Este número (o su número asociado) está repetido en la importación.'
	],
	[
		/^Number (\S+) is already used by a bond of this campaign\.?$/,
		(m) => `El número ${m[1]} ya está en uso en un bono de esta campaña.`
	],
	[
		/^Barcode (.+) is repeated in the import\.?$/,
		(m) => `El código de barras ${m[1]} está repetido en la importación.`
	],
	[
		/^Barcode (.+) is already used in this campaign\.?$/,
		(m) => `El código de barras ${m[1]} ya está en uso en esta campaña.`
	],
	[
		/^The pata code (.+) is already used in this campaign\.?$/,
		(m) => `El código de pata ${m[1]} ya está en uso en esta campaña.`
	],
	[
		/^The pata code (.+) is also used as a row barcode in this import\.?$/,
		(m) =>
			`El código de pata ${m[1]} también se usa como código de barras de una fila en esta importación.`
	],
	[
		/^A pata needs at least (\d+) rows \(this group has (\d+)\)\.?$/,
		(m) => `Una pata necesita al menos ${m[1]} filas (este grupo tiene ${m[2]}).`
	],
	// Parser errors (`parse_*`)
	[
		/^Unknown bond type (.+) \(use simple or pata\)\.?$/,
		(m) => `Tipo de bono desconocido: ${m[1]} (usar simple o pata).`
	],
	[
		/^The barcode is longer than (\d+) characters\.?$/,
		(m) => `El código de barras tiene más de ${m[1]} caracteres.`
	],
	[
		/^A simple bond cannot belong to the pata (.+)\.$/,
		(m) => `Un bono simple no puede pertenecer a la pata ${m[1]}.`
	],
	[
		/^The grupo_pata is longer than (\d+) characters\.?$/,
		(m) => `El grupo_pata tiene más de ${m[1]} caracteres.`
	],
	[
		/^Base number (.+) is not a whole number\.?$/,
		(m) => `El número base ${m[1]} no es un número entero.`
	],
	[
		/^Barcode (.+) cannot be read with the campaign pattern here: type the base number\.?$/,
		(m) =>
			`El código de barras ${m[1]} no se puede leer con el patrón de la campaña en este caso: ingresar el número base.`
	],
	[
		/^Base number (.+) does not match barcode (.+) \((\d+)\)\.?$/,
		(m) => `El número base ${m[1]} no coincide con el código de barras ${m[2]} (${m[3]}).`
	],
	[
		/^Barcode (.+) is not a base number\.?$/,
		(m) => `El código de barras ${m[1]} no es un número base.`
	],
	[
		/^Barcode (.+) does not match the campaign pattern\.?$/,
		(m) => `El código de barras ${m[1]} no coincide con el patrón de la campaña.`
	],
	// Errors raised by the `import_session_*` functions
	[
		/^row (\d+): a simple row cannot have a grupo_pata/,
		(m) => `Fila ${m[1]}: una fila de bono simple no puede tener grupo_pata`
	],
	[
		/^row (\d+): (.+)$/,
		(m) => {
			const rest = translateImportMessage(m[2]);
			return rest === m[2] ? `Fila ${m[1]}: ${m[2]}` : `Fila ${m[1]}: ${rest}`;
		}
	],
	[
		/^a row_number of the batch is already used in this session/,
		() => 'Un número de fila del archivo ya está cargado en esta sesión'
	],
	[/^a barcode is required/, () => 'Se requiere un código de barras'],
	[/^a rollback reason is required/, () => 'Se requiere un motivo para revertir la importación'],
	[/^at least one row is required/, () => 'Se requiere al menos una fila'],
	[/^a batch can stage at most (\d+) rows/, (m) => `Un lote admite como máximo ${m[1]} filas`],
	[
		/^a file import needs the original file name/,
		() => 'La importación de un archivo necesita el nombre original'
	],
	[
		/^barcode_scan sessions do not keep a file name/,
		() => 'Una sesión de escaneo no tiene archivo'
	],
	[
		/^file name is too long/,
		() => 'El nombre del archivo es demasiado largo (máximo 255 caracteres)'
	],
	[/^a pata row needs its grupo_pata/, () => 'Una fila de pata necesita su grupo_pata'],
	[/^only a pata row can have a grupo_pata/, () => 'Solo una fila de pata puede tener grupo_pata'],
	[/^invalid import source type/, () => 'Tipo de origen de importación no válido'],
	[
		/^import session \S+ has (\d+) bond\(s\) that cannot be rolled back/,
		(m) => `La sesión tiene ${m[1]} bono(s) que no se pueden revertir`
	],
	[
		/^only a validated import session can be confirmed/,
		() => 'Validar la importación antes de confirmarla'
	]
];

/** `message` in Spanish when a known pattern matches; otherwise `message` itself. */
export function translateImportMessage(message: string): string {
	for (const [pattern, translate] of PATTERNS) {
		const match = pattern.exec(message);
		if (match) return translate(match);
	}
	return message;
}

type ClassPart = string | false | null | undefined | ClassPart[];

/** Joins class names, skipping falsy values (arrays are flattened). */
export function cn(...parts: ClassPart[]): string {
	return parts
		.flat(Infinity as 1)
		.filter(Boolean)
		.join(' ');
}

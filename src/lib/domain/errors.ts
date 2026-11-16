/**
 * Base class for business-rule violations raised by the pure domain layer.
 *
 * Domain errors carry a stable, machine-readable `code` so callers (form actions,
 * services, UI) can map them to user-facing messages without parsing `message`.
 * They are expected errors (invalid input), not infrastructure failures.
 */
export class DomainError<Code extends string = string> extends Error {
	readonly code: Code;

	constructor(code: Code, message: string) {
		super(message);
		this.name = new.target.name;
		this.code = code;
	}
}

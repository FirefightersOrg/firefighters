import { getContext, setContext } from 'svelte';

/** What a `Field` shares with the control inside it (getters keep it reactive). */
export interface FieldContext {
	readonly id: string;
	readonly describedBy: string | undefined;
	readonly invalid: boolean;
	readonly required: boolean;
}

const KEY = Symbol('cimiento-field');

export function setFieldContext(ctx: FieldContext): void {
	setContext(KEY, ctx);
}

export function getFieldContext(): FieldContext | undefined {
	return getContext<FieldContext | undefined>(KEY);
}

/** Joins aria-describedby ids, skipping empty ones. */
export function joinIds(...ids: Array<string | undefined | null | false>): string | undefined {
	const joined = ids.filter(Boolean).join(' ');
	return joined || undefined;
}

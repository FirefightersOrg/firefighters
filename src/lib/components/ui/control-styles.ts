/** Shared look of TextInput, Select and Textarea (Cimiento tokens via the Tailwind theme). */
export const CONTROL_CLASS = [
	'w-full min-h-control-md pointer-coarse:min-h-touch px-3 py-[7px]',
	'border border-border-strong rounded-md bg-surface text-text text-input shadow-xs',
	'transition-colors duration-[120ms] motion-reduce:transition-none',
	'placeholder:text-subtle hover:border-muted',
	'focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus focus-visible:border-focus',
	'aria-invalid:border-danger',
	'read-only:bg-surface-sunken read-only:border-border read-only:shadow-none',
	'disabled:bg-surface-sunken disabled:text-disabled disabled:border-border disabled:shadow-none disabled:cursor-not-allowed'
].join(' ');

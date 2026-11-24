// Cimiento UI kit barrel. Every component is also importable from its own path
// (`$lib/components/ui/Button.svelte`). Each ticket owns one clearly separated block below.

// --- SAN-128: actions and form controls ---
export { default as Button } from './Button.svelte';
export { default as Icon } from './Icon.svelte';
export { default as Field } from './Field.svelte';
export { default as TextInput } from './TextInput.svelte';
export { default as Select } from './Select.svelte';
export { default as Textarea } from './Textarea.svelte';
export { default as Checkbox } from './Checkbox.svelte';
export { default as RadioGroup } from './RadioGroup.svelte';
export { ICON_NAMES, type IconName } from './icon-names';
// --- end SAN-128 ---

// --- SAN-129: feedback and structure components ---------------------------------------
export { default as Badge } from './Badge.svelte';
export { default as Alert } from './Alert.svelte';
export { default as Toast } from './Toast.svelte';
export { default as EmptyState } from './EmptyState.svelte';
export { default as Card } from './Card.svelte';
export { default as Section } from './Section.svelte';
export { default as Stat } from './Stat.svelte';
export { default as Disclosure } from './Disclosure.svelte';
export { default as StatusBadge } from './StatusBadge.svelte';
export { STATUS_MAP, statusMeta } from './status';
export type { StatusKind, StatusMeta, StatusOf } from './status';
export { TONES, type MessageTone, type Tone } from './tones';
export { TOAST_TIMEOUT_MS, toastTimeout } from './toast';
// --- end SAN-129 ---------------------------------------------------------------------

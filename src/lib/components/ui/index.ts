// Cimiento UI kit barrel. Each component is also importable by its own path.

// --- SAN-130: Table, Dialog, PageHeader, AppHeader ---
export { default as Table } from './Table.svelte';
export type { TableColumn } from './Table.svelte';
export { default as Dialog } from './Dialog.svelte';
export { default as PageHeader } from './PageHeader.svelte';
export type { Breadcrumb } from './PageHeader.svelte';
export { default as AppHeader } from './AppHeader.svelte';
export type { AppHeaderLink } from './AppHeader.svelte';
// --- end SAN-130 ---

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

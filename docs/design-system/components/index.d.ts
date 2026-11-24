import type * as React from 'react';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
type IconName =
	| 'check'
	| 'info'
	| 'alert'
	| 'error'
	| 'success'
	| 'x'
	| 'chevron-down'
	| 'plus'
	| 'search'
	| 'inbox'
	| 'download'
	| 'menu';

/** Acción. Una sola `primary` por vista. */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
	size?: 'sm' | 'md' | 'lg';
	icon?: IconName;
	iconEnd?: IconName;
	loading?: boolean;
	block?: boolean;
	href?: string;
}
export interface IconProps {
	name: IconName;
	size?: 'sm' | 'md';
	label?: string;
	className?: string;
}
export interface FieldProps {
	label: React.ReactNode;
	hint?: React.ReactNode;
	error?: React.ReactNode;
	optional?: boolean;
	required?: boolean;
	id?: string;
	children: React.ReactNode;
}
export interface TextInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
	invalid?: boolean;
	mono?: boolean;
	prefix?: string;
}
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
	options?: Array<string | { value: string; label: string; disabled?: boolean }>;
	placeholder?: string;
	invalid?: boolean;
}
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
	invalid?: boolean;
}
export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
	label: React.ReactNode;
	description?: React.ReactNode;
}
export interface RadioGroupProps {
	legend: React.ReactNode;
	options: Array<{
		value: string;
		label: React.ReactNode;
		description?: React.ReactNode;
		disabled?: boolean;
	}>;
	value?: string;
	defaultValue?: string;
	onChange?: (value: string) => void;
	name?: string;
}
export interface BadgeProps {
	tone?: Tone;
	dot?: boolean;
	children: React.ReactNode;
}
export interface AlertProps {
	tone?: Exclude<Tone, 'neutral'>;
	title?: React.ReactNode;
	actions?: React.ReactNode;
	onDismiss?: () => void;
	children?: React.ReactNode;
}
export interface ToastProps {
	tone?: Exclude<Tone, 'neutral'>;
	action?: React.ReactNode;
	onDismiss?: () => void;
	inline?: boolean;
	children: React.ReactNode;
}
export interface EmptyStateProps {
	title: React.ReactNode;
	icon?: IconName;
	actions?: React.ReactNode;
	children?: React.ReactNode;
}
export interface CardProps {
	title?: React.ReactNode;
	description?: React.ReactNode;
	actions?: React.ReactNode;
	footer?: React.ReactNode;
	flush?: boolean;
	as?: string;
	id?: string;
	children?: React.ReactNode;
}
export interface SectionProps {
	id: string;
	number?: number;
	title: React.ReactNode;
	actions?: React.ReactNode;
	children: React.ReactNode;
}
export interface StatProps {
	label: React.ReactNode;
	value: React.ReactNode;
	detail?: React.ReactNode;
}
export interface TableColumn<Row> {
	key: string;
	header: React.ReactNode;
	align?: 'left' | 'right' | 'center';
	mono?: boolean;
	width?: string;
	render?: (row: Row) => React.ReactNode;
}
export interface TableProps<Row = Record<string, unknown>> {
	columns: TableColumn<Row>[];
	rows: Row[];
	rowKey?: string;
	caption?: React.ReactNode;
	density?: 'comfortable' | 'compact';
	selectedKey?: string | number;
	onRowClick?: (row: Row) => void;
	maxHeight?: string;
	empty?: React.ReactNode;
}
export interface DisclosureProps {
	summary: React.ReactNode;
	meta?: React.ReactNode;
	defaultOpen?: boolean;
	children: React.ReactNode;
}
export interface DialogProps {
	open: boolean;
	title: React.ReactNode;
	description?: React.ReactNode;
	confirmLabel: React.ReactNode;
	cancelLabel?: React.ReactNode;
	tone?: 'default' | 'danger';
	loading?: boolean;
	confirmDisabled?: boolean;
	onConfirm: () => void;
	onClose: () => void;
	children?: React.ReactNode;
}
export interface PageHeaderProps {
	title: React.ReactNode;
	description?: React.ReactNode;
	breadcrumbs?: Array<{ label: React.ReactNode; href?: string }>;
	actions?: React.ReactNode;
}
export interface AppHeaderProps {
	product: React.ReactNode;
	homeHref?: string;
	links?: Array<{ label: React.ReactNode; href: string; current?: boolean }>;
	user?: React.ReactNode;
	userActions?: React.ReactNode;
}

export declare const Button: React.FC<ButtonProps>;
export declare const Icon: React.FC<IconProps> & { names: IconName[] };
export declare const Field: React.FC<FieldProps>;
export declare const TextInput: React.FC<TextInputProps>;
export declare const Select: React.FC<SelectProps>;
export declare const Textarea: React.FC<TextareaProps>;
export declare const Checkbox: React.FC<CheckboxProps>;
export declare const RadioGroup: React.FC<RadioGroupProps>;
export declare const Badge: React.FC<BadgeProps>;
export declare const Alert: React.FC<AlertProps>;
export declare const Toast: React.FC<ToastProps>;
export declare const EmptyState: React.FC<EmptyStateProps>;
export declare const Card: React.FC<CardProps>;
export declare const Section: React.FC<SectionProps>;
export declare const Stat: React.FC<StatProps>;
export declare function Table<Row>(props: TableProps<Row>): React.ReactElement;
export declare const Disclosure: React.FC<DisclosureProps>;
export declare const Dialog: React.FC<DialogProps>;
export declare const PageHeader: React.FC<PageHeaderProps>;
export declare const AppHeader: React.FC<AppHeaderProps>;

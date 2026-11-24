<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Confirmation dialog on the native `<dialog>` + `showModal()`: the browser provides the top
	 * layer, the focus trap, `Esc`, and returns focus to the trigger on close. Content and
	 * buttons live in a real `<form>`, so it works with SvelteKit form actions: the confirm
	 * button is `type="submit"`. Pass `onConfirm` instead for client-only confirmations.
	 */
	let {
		open,
		onClose,
		onConfirm,
		title,
		description,
		confirmLabel,
		cancelLabel = 'Cancelar',
		tone = 'default',
		loading = false,
		confirmDisabled = false,
		action,
		method = 'POST',
		enhance,
		children
	}: {
		open: boolean;
		onClose: () => void;
		/** When set, the form submit is prevented and this runs instead of posting. */
		onConfirm?: () => void;
		/** Question naming the action and the object: «¿Anular 3 registros?» */
		title: string;
		/** Consequence, and whether it can be undone. */
		description?: string;
		/** Repeats the action; never «Sí» or «Aceptar». */
		confirmLabel: string;
		cancelLabel?: string;
		/** `danger`: red confirm button and initial focus on the cancel button. */
		tone?: 'default' | 'danger';
		loading?: boolean;
		confirmDisabled?: boolean;
		/** Form action URL (e.g. `?/annul`). */
		action?: string;
		method?: 'POST' | 'GET';
		/** Attach a form action such as SvelteKit's `enhance` from `$app/forms`. */
		enhance?: (form: HTMLFormElement) => void | { destroy?: () => void };
		/** Extra fields (reason, checkbox) rendered between the description and the buttons. */
		children?: Snippet;
	} = $props();

	const uid = $props.id();
	const titleId = `${uid}-title`;
	const descriptionId = `${uid}-description`;

	let dialog = $state<HTMLDialogElement>();

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		else if (!open && dialog.open) dialog.close();
	});

	// Native close (Esc) or our own close() ends here; tell the parent only while it still thinks
	// the dialog is open, so a parent-driven close does not echo back.
	function handleClose() {
		if (open) onClose();
	}

	function handleBackdropClick(event: MouseEvent) {
		// The content wrapper fills the dialog box, so only the ::backdrop targets the dialog itself.
		if (event.target === dialog && !loading) onClose();
	}

	function handleCancel(event: Event) {
		// Do not let Esc dismiss the dialog while a submission is in flight.
		if (loading) event.preventDefault();
	}

	function handleSubmit(event: SubmitEvent) {
		if (onConfirm) {
			event.preventDefault();
			if (!loading && !confirmDisabled) onConfirm();
		}
	}

	function attachEnhance(node: HTMLFormElement) {
		return enhance?.(node);
	}

	const confirmClass = $derived(
		tone === 'danger'
			? 'bg-danger text-on-danger hover:bg-danger-hover'
			: 'bg-primary text-on-primary hover:bg-primary-hover'
	);
</script>

<dialog
	bind:this={dialog}
	aria-labelledby={titleId}
	aria-describedby={description ? descriptionId : undefined}
	class="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border border-border bg-surface-raised p-0 text-text shadow-lg backdrop:bg-overlay"
	onclose={handleClose}
	oncancel={handleCancel}
	onclick={handleBackdropClick}
>
	<form {method} {action} onsubmit={handleSubmit} use:attachEnhance class="flex flex-col gap-4 p-6">
		<h2 id={titleId} class="text-heading-2 text-text">{title}</h2>
		{#if description}
			<p id={descriptionId} class="text-body text-muted">{description}</p>
		{/if}
		{#if children}
			<div class="flex flex-col gap-3">{@render children()}</div>
		{/if}
		<div class="flex flex-col-reverse gap-2 min-[720px]:flex-row min-[720px]:justify-end">
			<!-- svelte-ignore a11y_autofocus -->
			<button
				type="button"
				data-dialog-cancel
				autofocus={tone === 'danger'}
				disabled={loading}
				onclick={onClose}
				class="inline-flex min-h-touch w-full cursor-pointer items-center justify-center rounded-md border border-border-strong bg-surface px-4 text-label text-text hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:text-disabled min-[720px]:min-h-control-md min-[720px]:w-auto"
				>{cancelLabel}</button
			>
			<button
				type="submit"
				data-dialog-confirm
				disabled={confirmDisabled || loading}
				aria-busy={loading || undefined}
				class="inline-flex min-h-touch w-full cursor-pointer items-center justify-center rounded-md px-4 text-label focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-disabled min-[720px]:min-h-control-md min-[720px]:w-auto {confirmClass}"
				>{confirmLabel}</button
			>
		</div>
	</form>
</dialog>

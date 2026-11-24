<script lang="ts">
	import { resolve } from '$app/paths';
	import { Button, Card, Checkbox, Dialog } from '$lib/components/ui';
	import { RISKY_OPERATION_STEPS } from '$lib/domain/backup-exports';

	/**
	 * The 6-step checklist before a risky operation (docs/backup-operations.md). Every step is a
	 * checkbox. With `confirmLabel`, a danger dialog confirms the operation and its confirm button
	 * stays inactive, with a hint, until every step is checked. With `confirmAction` the dialog
	 * submits that form action; otherwise it calls `onConfirm`.
	 */
	let {
		campaignId,
		operation,
		canExport,
		confirmLabel,
		confirmAction,
		onConfirm
	}: {
		campaignId: string;
		operation: string;
		canExport: boolean;
		confirmLabel?: string;
		confirmAction?: string;
		onConfirm?: () => void;
	} = $props();

	let checked = $state(RISKY_OPERATION_STEPS.map(() => false));
	let open = $state(false);
	const done = $derived(checked.filter(Boolean).length);
	const complete = $derived(done === RISKY_OPERATION_STEPS.length);
</script>

<Card
	title="Antes de {operation}: lista de 6 pasos"
	description="{done} de {RISKY_OPERATION_STEPS.length} pasos marcados."
>
	<fieldset class="space-y-2">
		<legend class="sr-only">Pasos antes de {operation}</legend>
		{#each RISKY_OPERATION_STEPS as step, i (step)}
			<Checkbox label="{i + 1}. {step}" bind:checked={checked[i]} />
		{/each}
	</fieldset>
	<p class="mt-3 text-body-sm text-muted">
		{#if canExport}
			Paso 1:
			<a
				href={resolve('/campaigns/[id]/backups', { id: campaignId })}
				class="rounded-sm text-primary-text underline underline-offset-2"
				>descargar las exportaciones de respaldo</a
			>.
		{:else}
			El paso 1 lo tiene que hacer alguien con el permiso de exportación (administrador).
		{/if}
		Los pasos 2, 3, 5 y 6 se registran fuera de la aplicación (ver docs/backup-operations.md).
	</p>
	{#if confirmLabel}
		<div class="mt-4">
			<Button variant="danger" onclick={() => (open = true)}>{confirmLabel}</Button>
		</div>
		<Dialog
			{open}
			onClose={() => (open = false)}
			onConfirm={confirmAction
				? undefined
				: () => {
						open = false;
						onConfirm?.();
					}}
			action={confirmAction}
			title={confirmLabel}
			description="Esta operación es riesgosa. Confirmá solo después de completar la lista."
			{confirmLabel}
			tone="danger"
			confirmDisabled={!complete}
		>
			{#if !complete}
				<p class="text-body-sm text-muted" id="risky-hint">
					Marcá los {RISKY_OPERATION_STEPS.length} pasos de la lista para habilitar la confirmación (faltan
					{RISKY_OPERATION_STEPS.length - done}).
				</p>
			{:else}
				<p class="text-body-sm">La lista está completa.</p>
			{/if}
		</Dialog>
	{/if}
</Card>

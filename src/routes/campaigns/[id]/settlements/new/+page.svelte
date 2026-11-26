<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		Alert,
		Button,
		Card,
		Field,
		FormResult,
		PageHeader,
		Select,
		Textarea
	} from '$lib/components/ui';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const result = $derived(
		form as {
			message?: string;
			errors?: Record<string, string[]>;
			values?: Record<string, string>;
		} | null
	);
	const collectorOptions = $derived([
		{ value: '', label: 'Elegir…' },
		...data.collectors.map((c) => ({ value: c.id, label: c.displayName }))
	]);
	// Writable: starts from what the server sent back and follows the select.
	let collectorId = $derived(result?.values?.collectorId ?? '');
	/** The chosen collector's open settlement, if there is one: payments go there. */
	const existing = $derived(data.openSettlements.find((s) => s.collectorId === collectorId));
	const collectorName = $derived(
		data.collectors.find((c) => c.id === collectorId)?.displayName ?? ''
	);
	const title = $derived(data.forPayment ? 'Registrar pago' : 'Abrir rendición');
	const fields = [
		{ name: 'collectorId', label: 'Cobrador', id: 'collectorId' },
		{ name: 'notes', label: 'Observaciones', id: 'notes' }
	];
</script>

<svelte:head><title>{title} - {data.campaign.name}</title></svelte:head>

<PageHeader
	{title}
	description={data.forPayment
		? 'Los pagos se cargan en la rendición abierta del cobrador. Si no tiene una, se abre ahora.'
		: undefined}
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: data.campaign.name, href: resolve('/campaigns/[id]', { id: data.campaign.id }) },
		{
			label: 'Rendiciones',
			href: resolve('/campaigns/[id]/settlements', { id: data.campaign.id })
		},
		{ label: title }
	]}
/>

<div class="max-w-xl space-y-6">
	<FormResult
		result={result?.message
			? { success: false, message: result.message, errors: result.errors }
			: null}
		{fields}
	/>
	<Card>
		<form method="POST" action="?/create" class="space-y-4">
			<Field label="Cobrador" id="collectorId" required error={result?.errors?.collectorId?.[0]}>
				<Select name="collectorId" options={collectorOptions} bind:value={collectorId} />
			</Field>
			{#if existing}
				<Alert
					tone="info"
					title="{collectorName} ya tiene abierta la rendición {existing.settlementNumber}"
				>
					Los pagos se cargan ahí. Para abrir otra, primero hay que cerrar esa.
				</Alert>
				<Button
					variant="primary"
					href={resolve('/campaigns/[id]/settlements/[settlementId]', {
						id: data.campaign.id,
						settlementId: existing.id
					})}>Cargar pagos en la rendición {existing.settlementNumber}</Button
				>
			{:else}
				<Field label="Observaciones" id="notes" optional error={result?.errors?.notes?.[0]}>
					<Textarea name="notes" value={result?.values?.notes ?? ''} />
				</Field>
				<Button type="submit" variant="primary"
					>{data.forPayment ? 'Abrir rendición y cargar pagos' : 'Abrir rendición'}</Button
				>
			{/if}
		</form>
	</Card>
</div>

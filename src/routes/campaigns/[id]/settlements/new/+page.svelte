<script lang="ts">
	import { resolve } from '$app/paths';
	import {
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
	const fields = [
		{ name: 'collectorId', label: 'Cobrador', id: 'collectorId' },
		{ name: 'notes', label: 'Observaciones', id: 'notes' }
	];
</script>

<svelte:head><title>Abrir rendición - {data.campaign.name}</title></svelte:head>

<PageHeader
	title="Abrir rendición"
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: data.campaign.name, href: resolve('/campaigns/[id]', { id: data.campaign.id }) },
		{
			label: 'Rendiciones',
			href: resolve('/campaigns/[id]/settlements', { id: data.campaign.id })
		},
		{ label: 'Abrir rendición' }
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
				<Select
					name="collectorId"
					options={collectorOptions}
					value={result?.values?.collectorId ?? ''}
				/>
			</Field>
			<Field label="Observaciones" id="notes" optional error={result?.errors?.notes?.[0]}>
				<Textarea name="notes" value={result?.values?.notes ?? ''} />
			</Field>
			<Button type="submit" variant="primary">Abrir rendición</Button>
		</form>
	</Card>
</div>

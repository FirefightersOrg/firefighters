<script lang="ts">
	import { resolve } from '$app/paths';
	import CollectorForm from '$lib/components/collectors/CollectorForm.svelte';
	import { PageHeader } from '$lib/components/ui';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const listHref = $derived(resolve('/campaigns/[id]/collectors', { id: data.campaign.id }));
</script>

<svelte:head><title>Nuevo cobrador - {data.campaign.name} - Firefighters</title></svelte:head>

<PageHeader
	title="Nuevo cobrador"
	description="Los cobradores son globales: se pueden usar en todas las campañas."
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: data.campaign.name, href: resolve('/campaigns/[id]', { id: data.campaign.id }) },
		{ label: 'Cobradores', href: listHref },
		{ label: 'Nuevo cobrador' }
	]}
/>

<CollectorForm
	profiles={data.profiles}
	{form}
	submitLabel="Guardar cobrador"
	cancelHref={listHref}
/>

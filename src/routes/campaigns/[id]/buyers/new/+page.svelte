<script lang="ts">
	import { institutionName } from '$lib/institution';
	import { resolve } from '$app/paths';
	import BuyerForm from '$lib/components/buyers/BuyerForm.svelte';
	import { PageHeader } from '$lib/components/ui';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const listHref = $derived(resolve('/campaigns/[id]/buyers', { id: data.campaign.id }));
</script>

<svelte:head
	><title>Nuevo comprador - {data.campaign.name} - {institutionName()}</title></svelte:head
>

<PageHeader
	title="Nuevo comprador"
	description="Los compradores son globales: se pueden usar en todas las campañas."
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: data.campaign.name, href: resolve('/campaigns/[id]', { id: data.campaign.id }) },
		{ label: 'Compradores', href: listHref },
		{ label: 'Nuevo comprador' }
	]}
/>

<BuyerForm
	campaignId={data.campaign.id}
	collectors={data.collectors}
	canViewCollectors={data.canViewCollectors}
	{form}
	cancelHref={listHref}
/>

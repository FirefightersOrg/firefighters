<script lang="ts">
	import { resolve } from '$app/paths';
	import BuyerForm from '$lib/components/buyers/BuyerForm.svelte';
	import FormAlert from '$lib/components/campaigns/FormAlert.svelte';
	import { cardClass } from '$lib/components/campaigns/styles';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
</script>

<div class="space-y-6">
	<a
		class="text-sm text-blue-700 underline"
		href={resolve('/campaigns/[id]/buyers', { id: data.campaign.id })}>← Buyers</a
	>
	<h1 class="text-2xl font-bold">New buyer</h1>
	{#if form?.message}<FormAlert message={form.message} />{/if}
	<section class={cardClass}>
		<BuyerForm
			campaignId={data.campaign.id}
			collectors={data.collectors}
			canViewCollectors={data.canViewCollectors}
			{form}
		/>
	</section>
</div>

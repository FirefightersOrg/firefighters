<script lang="ts">
	import { resolve } from '$app/paths';
	import BondStatusBadge from '$lib/components/bonds/BondStatusBadge.svelte';
	import BondActionsSection from '$lib/components/bonds/record/BondActionsSection.svelte';
	import BondGeneralSection from '$lib/components/bonds/record/BondGeneralSection.svelte';
	import BondGroupSection from '$lib/components/bonds/record/BondGroupSection.svelte';
	import BondNumbersSection from '$lib/components/bonds/record/BondNumbersSection.svelte';
	import FormAlert from '$lib/components/campaigns/FormAlert.svelte';
	import type { PageProps } from './$types';

	/**
	 * Bond record. One component per section (docs/screens.md "Bond record"): general data,
	 * participating numbers, manual pata membership / members, actions. Further sections
	 * (collector, buyer, sale, installments, payments, ...) are added as new components.
	 */
	let { data, form }: PageProps = $props();

	const campaign = $derived(data.campaign);
	const record = $derived(data.record);
	const general = $derived(record.general);
	const title = $derived(
		record.numbers.length > 0
			? `${general.typeLabel} ${record.numbers
					.filter((n) => n.kind === 'base')
					.map((n) => n.formatted)
					.join(' + ')}`
			: general.typeLabel
	);
	const errors = $derived({
		ungroup: form?.form === 'ungroup' && !form.success ? form.errors.reason : undefined,
		annul: form?.form === 'annul' && !form.success ? form.errors.reason : undefined
	});
</script>

<svelte:head>
	<title>{title} - {campaign.name} - Firefighters</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<a
			href={resolve('/campaigns/[id]', { id: campaign.id })}
			class="text-sm text-blue-700 hover:underline">← {campaign.name}</a
		>
		<div class="mt-2 flex flex-wrap items-center gap-3">
			<h1 class="text-2xl font-bold tracking-tight">{title}</h1>
			<BondStatusBadge status={general.commercialStatus} />
		</div>
	</div>

	{#if form?.success}
		<FormAlert kind="success" message={form.message} />
	{:else if form?.message && !form.errors.reason?.length}
		<FormAlert message={form.message} />
	{/if}

	<BondGeneralSection {general} />
	<BondNumbersSection campaignId={campaign.id} bondId={general.id} numbers={record.numbers} />
	<BondGroupSection
		campaignId={campaign.id}
		group={record.group}
		isManualPata={general.origin === 'manual_grouping'}
	/>
	<BondActionsSection actions={record.actions} isPata={general.kind === 'pata'} {errors} />
</div>

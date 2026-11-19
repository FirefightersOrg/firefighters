<script lang="ts">
	import { resolve } from '$app/paths';
	import BondStatusBadge from '$lib/components/bonds/BondStatusBadge.svelte';
	import BondActionsSection from '$lib/components/bonds/record/BondActionsSection.svelte';
	import BondAuditSection from '$lib/components/bonds/record/BondAuditSection.svelte';
	import BondCustodySection from '$lib/components/bonds/record/BondCustodySection.svelte';
	import BondBarcodeSection from '$lib/components/bonds/record/BondBarcodeSection.svelte';
	import BondGeneralSection from '$lib/components/bonds/record/BondGeneralSection.svelte';
	import BondNumbersSection from '$lib/components/bonds/record/BondNumbersSection.svelte';
	import BondPartySection from '$lib/components/bonds/record/BondPartySection.svelte';
	import BondPendingSection from '$lib/components/bonds/record/BondPendingSection.svelte';
	import { BOND_RECORD_SECTIONS } from '$lib/components/bonds/record/types';
	import FormAlert from '$lib/components/campaigns/FormAlert.svelte';
	import type { PageProps } from './$types';

	/**
	 * Bond record: the 14 sections of docs/screens.md "Bond record", one component each, with an
	 * index of anchors at the top. The actions (ungroup / annul) follow the general data.
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
		<nav aria-label="Breadcrumb" class="flex flex-wrap gap-x-2 text-sm">
			<a
				href={resolve('/campaigns/[id]', { id: campaign.id })}
				class="text-blue-700 hover:underline">← {campaign.name}</a
			>
			<span aria-hidden="true" class="text-slate-400">/</span>
			<a
				href={resolve('/campaigns/[id]/bonds', { id: campaign.id })}
				class="text-blue-700 hover:underline">Bonds</a
			>
		</nav>
		<div class="mt-2 flex flex-wrap items-center gap-3">
			<h1 class="text-2xl font-bold tracking-tight">{title}</h1>
			<BondStatusBadge status={general.commercialStatus} />
		</div>
		<nav aria-label="Record sections" class="mt-3">
			<ol class="flex flex-wrap gap-x-4 gap-y-1 text-xs">
				{#each BOND_RECORD_SECTIONS as section, i (section.id)}
					<li>
						<a href="#{section.id}" class="text-blue-700 hover:underline"
							>{i + 1}. {section.title}</a
						>
					</li>
				{/each}
			</ol>
		</nav>
	</div>

	{#if form?.success}
		<FormAlert kind="success" message={form.message} />
	{:else if form?.message && !form.errors.reason?.length}
		<FormAlert message={form.message} />
	{/if}

	<BondGeneralSection campaignId={campaign.id} {general} group={record.group} />
	<BondActionsSection actions={record.actions} isPata={general.kind === 'pata'} {errors} />
	<BondNumbersSection campaignId={campaign.id} bondId={general.id} numbers={record.numbers} />
	<BondBarcodeSection barcode={record.barcode} />
	<BondPartySection role="collector" party={record.collector} />
	<BondCustodySection
		campaignId={campaign.id}
		fromCollectorId={data.custody.fromCollectorId}
		history={data.custody.history}
		collectors={data.custody.collectors}
		can={data.custody.can}
		form={form?.form === 'custody' ? form : null}
	/>
	<BondPartySection role="buyer" party={record.buyer} />
	<BondPendingSection id="sale" />
	<BondPendingSection id="installments" />
	<BondPendingSection id="payments" />
	<BondPendingSection id="settlements" />
	<BondPendingSection id="commissions" />
	<BondPendingSection id="draws" />
	<BondPendingSection id="prizes" />
	<BondAuditSection campaignId={campaign.id} audit={record.audit} />
</div>

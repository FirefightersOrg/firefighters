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
	import { PAYMENT_MODE_LABELS, INSTALLMENT_STATUS_LABELS } from '$lib/domain/sales';
	import { formatMoney } from '$lib/domain/money';
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
	<section
		id="sale"
		aria-labelledby="sale-title"
		class="rounded-lg border border-slate-200 bg-white p-5"
	>
		<h2 id="sale-title" class="text-base font-semibold">
			<span class="text-slate-400 tabular-nums">7.</span> Sale
		</h2>
		{#if data.sale}<p class="mt-2 text-sm">
				Active sale — <a
					class="text-blue-700 underline"
					href={resolve('/campaigns/[id]/sales/[saleId]', {
						id: campaign.id,
						saleId: data.sale.sale.id
					})}>view sale</a
				>. {PAYMENT_MODE_LABELS[data.sale.sale.paymentMode]}, {formatMoney(
					data.sale.sale.totalAmount
				)}.
			</p>{:else}<p class="mt-2 text-sm text-slate-500">This bond has not been sold.</p>{/if}
	</section>
	<section
		id="installments"
		aria-labelledby="installments-title"
		class="rounded-lg border border-slate-200 bg-white p-5"
	>
		<h2 id="installments-title" class="text-base font-semibold">
			<span class="text-slate-400 tabular-nums">8.</span> Installments
		</h2>
		{#if (data.installments ?? []).length}<table class="mt-2 text-sm">
				<tbody
					>{#each data.installments as installment (installment.id)}<tr
							><td class="pr-3">{installment.installmentNumber}</td><td class="pr-3"
								>{installment.dueDate}</td
							><td class="pr-3">{formatMoney(installment.amount)}</td><td
								>{INSTALLMENT_STATUS_LABELS[installment.status]}</td
							></tr
						>{/each}</tbody
				>
			</table>{:else}<p class="mt-2 text-sm text-slate-500">No installment plan.</p>{/if}
	</section>
	<BondPendingSection id="payments" />
	<BondPendingSection id="settlements" />
	<BondPendingSection id="commissions" />
	<BondPendingSection id="draws" />
	<BondPendingSection id="prizes" />
	<BondAuditSection campaignId={campaign.id} audit={record.audit} />
</div>

<script lang="ts">
	import { resolve } from '$app/paths';
	import { cardClass } from '$lib/components/campaigns/styles';
	import { PAYMENT_MODE_LABELS, INSTALLMENT_STATUS_LABELS } from '$lib/domain/sales';
	import { formatMoney } from '$lib/domain/money';
	import { campaignNumberingConfig } from '$lib/domain/campaigns';
	import { formatCampaignNumber } from '$lib/domain/numbering';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	const numbering = $derived(campaignNumberingConfig(data.campaign));
	const bondLabel = $derived(
		data.sale.bondNumberPairs
			.map(
				({ base, associated }) =>
					`${formatCampaignNumber(base, numbering)}${
						associated === null ? '' : ` / ${formatCampaignNumber(associated, numbering)}`
					}`
			)
			.join(', ')
	);
</script>

<svelte:head><title>Sale - {data.campaign.name}</title></svelte:head>
<div class="space-y-6">
	<a
		class="text-sm text-blue-700 hover:underline"
		href={resolve('/campaigns/[id]/sales', { id: data.campaign.id })}>← Sales</a
	>
	<h1 class="text-2xl font-bold">Sale</h1>
	<section class={cardClass}>
		<dl class="grid gap-3 text-sm sm:grid-cols-3">
			<div>
				<dt>Bond</dt>
				<dd>
					<a
						class="text-blue-700 underline"
						href={resolve('/campaigns/[id]/bonds/[bondId]', {
							id: data.campaign.id,
							bondId: data.sale.bondId
						})}>{bondLabel}</a
					>
				</dd>
			</div>
			<div>
				<dt>Buyer</dt>
				<dd>
					<a
						class="text-blue-700 underline"
						href={resolve('/campaigns/[id]/buyers/[buyerId]', {
							id: data.campaign.id,
							buyerId: data.sale.sale.buyerId
						})}>{data.sale.buyerName}</a
					>
				</dd>
			</div>
			<div>
				<dt>Collector</dt>
				<dd>
					<a
						class="text-blue-700 underline"
						href={resolve('/campaigns/[id]/collectors/[collectorId]', {
							id: data.campaign.id,
							collectorId: data.sale.sale.collectorId
						})}>{data.sale.collectorName}</a
					>
				</dd>
			</div>
			<div>
				<dt>Modality</dt>
				<dd>{PAYMENT_MODE_LABELS[data.sale.sale.paymentMode]}</dd>
			</div>
			<div>
				<dt>Total</dt>
				<dd>{formatMoney(data.sale.sale.totalAmount)}</dd>
			</div>
			<div>
				<dt>Financial status snapshot</dt>
				<dd>{data.financialStatusSnapshot.replaceAll('_', ' ')}</dd>
			</div>
		</dl>
	</section>
	<section class={cardClass}>
		<h2 class="mb-3 font-semibold">Installment schedule</h2>
		<table class="min-w-full text-sm">
			<thead
				><tr
					><th class="text-left">#</th><th class="text-left">Due date</th><th class="text-left"
						>Amount</th
					><th class="text-left">Status</th></tr
				></thead
			><tbody
				>{#each data.sale.installments as installment (installment.id)}<tr
						><td>{installment.installmentNumber}</td><td>{installment.dueDate}</td><td
							>{formatMoney(installment.amount)}</td
						><td>{INSTALLMENT_STATUS_LABELS[installment.status]}</td></tr
					>{/each}</tbody
			>
		</table>
	</section>
</div>

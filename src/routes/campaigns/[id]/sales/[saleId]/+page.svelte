<script lang="ts">
	import { resolve } from '$app/paths';
	import FormAlert from '$lib/components/campaigns/FormAlert.svelte';
	import {
		cardClass,
		inputClass,
		labelClass,
		secondaryButtonClass
	} from '$lib/components/campaigns/styles';
	import { PAYMENT_MODE_LABELS, INSTALLMENT_STATUS_LABELS } from '$lib/domain/sales';
	import { formatMoney } from '$lib/domain/money';
	import { campaignNumberingConfig } from '$lib/domain/campaigns';
	import { formatCampaignNumber } from '$lib/domain/numbering';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
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
	{#if form?.message}<FormAlert
			kind={form.success ? 'success' : 'error'}
			message={form.message}
		/>{/if}
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
	{#if data.correction}<section class={cardClass}>
			<h2 class="font-semibold">Audited corrections</h2>
			<p class="mt-1 text-xs text-amber-800">
				<strong>Indicative preview:</strong> buyer changes do not move ledger entries. Collector changes
				compensate historical commission between collectors using current rule precedence; persisted database
				calculations are authoritative.
			</p>
			<div class="mt-3 grid gap-4 sm:grid-cols-2">
				<form method="POST" action="?/correctBuyer" class="space-y-2">
					<label class={labelClass} for="newBuyerId">Correct buyer</label>
					<select class={inputClass} id="newBuyerId" name="newBuyerId" required
						><option value="">Choose…</option
						>{#each data.correction.buyers as buyer (buyer.id)}<option value={buyer.id}
								>{buyer.businessName ??
									[buyer.firstName, buyer.lastName].filter(Boolean).join(' ')}</option
							>{/each}</select
					>
					<label class={labelClass} for="buyer-reason">Reason (max. 1000 Unicode characters)</label>
					<textarea class={inputClass} id="buyer-reason" name="reason" required></textarea>
					<button class={secondaryButtonClass}>Confirm buyer correction</button>
				</form>
				<form method="POST" action="?/correctCollector" class="space-y-2">
					<label class={labelClass} for="newCollectorId">Correct collector</label>
					<select class={inputClass} id="newCollectorId" name="newCollectorId" required
						><option value="">Choose…</option
						>{#each data.correction.collectors as collector (collector.id)}<option
								value={collector.id}>{collector.displayName}</option
							>{/each}</select
					>
					<label class={labelClass} for="collector-reason"
						>Reason (max. 1000 Unicode characters)</label
					>
					<textarea class={inputClass} id="collector-reason" name="reason" required></textarea>
					<button class={secondaryButtonClass}>Confirm collector correction</button>
				</form>
			</div>
		</section>{/if}
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

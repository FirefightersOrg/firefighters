<script lang="ts">
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import FormAlert from '$lib/components/campaigns/FormAlert.svelte';
	import {
		cardClass,
		inputClass,
		labelClass,
		primaryButtonClass,
		secondaryButtonClass
	} from '$lib/components/campaigns/styles';
	import { formatMoney } from '$lib/domain/money';
	import { formatCampaignDate } from '$lib/domain/campaigns';
	import { PAYMENT_METHOD_LABELS, SETTLEMENT_STATUS_LABELS } from '$lib/domain/payments';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	let saleId = $state('');
	const selected = $derived(data.candidates.filter((x) => x.saleId === saleId));
	const metric = (label: string, value: string) => ({ label, value });
	const metrics = $derived([
		metric('Total cash', data.totals.totalCash),
		metric('Total transfer', data.totals.totalTransfer),
		metric('Grand total', data.totals.totalAmount),
		metric('Preliminary commission', data.totals.commissionAmount),
		metric('Commission settled now', data.totals.commissionPaidAmount),
		metric('Net to Firefighters', data.totals.netToFirefighters),
		metric('Collector credit balance', data.totals.collectorCreditBalance)
	]);
</script>

<div class="space-y-6">
	<div>
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a
			class="text-sm text-blue-700 hover:underline"
			href={resolve('/campaigns/[id]/settlements', { id: data.campaign.id })}>← Settlements</a
		>
		<div class="mt-2 flex gap-3">
			<h1 class="text-2xl font-bold">Settlement #{data.settlement.settlementNumber}</h1>
			<span>{SETTLEMENT_STATUS_LABELS[data.settlement.status]}</span>
		</div>
		<p class="text-sm text-slate-500">
			{data.settlement.collectorName} · opened {formatCampaignDate(data.settlement.openedAt)}
		</p>
	</div>
	{#if form?.message}<FormAlert
			kind={form.success ? 'success' : 'error'}
			message={form.message}
		/>{/if}
	<section class={cardClass}>
		<h2 class="mb-4 text-base font-semibold">Summary</h2>
		<dl class="grid gap-4 text-sm sm:grid-cols-3">
			{#each metrics as item (item.label)}<div>
					<dt class="text-slate-500">{item.label}</dt>
					<dd class="font-semibold tabular-nums">{formatMoney(item.value)}</dd>
				</div>{/each}
		</dl>
	</section>
	{#if data.settlement.status !== 'open'}<section class={cardClass}>
			<h2 class="text-base font-semibold">Settlement documents</h2>
			<p class="mt-2 text-sm">
				<a
					class="text-blue-700 hover:underline"
					href={resolve(`/campaigns/${data.campaign.id}/settlements/${data.settlement.id}/print`)}
					>Print delivery note</a
				>
			</p>
		</section>{:else}
		{#if data.can.add}<section class={cardClass}>
				<h2 class="mb-4 text-base font-semibold">Fast payment entry</h2>
				<form method="POST" action="?/add" use:enhance class="space-y-4">
					<div>
						<label class={labelClass} for="sale">Bond / buyer</label><select
							class={inputClass}
							id="sale"
							name="saleId"
							bind:value={saleId}
							><option value="">Choose a bond or buyer…</option
							>{#each data.candidates as c (c.id)}{#if !data.candidates.find((x) => x.saleId === c.saleId && x.id !== c.id)}<option
										value={c.saleId}>Bond {c.bond} — {c.buyer}</option
									>{/if}{/each}</select
						>
					</div>
					{#if selected.length}<table class="min-w-full text-sm">
							<thead class="text-left text-xs text-slate-500"
								><tr><th>Apply</th><th>Installment</th><th>Due</th><th>Amount</th></tr></thead
							><tbody
								>{#each selected as item (item.id)}<tr
										><td><input type="checkbox" name="installmentId" value={item.id} /></td><td
											>{item.number} ({item.status})</td
										><td>{item.dueDate}</td><td
											><input class={inputClass} name="amount-{item.id}" value={item.amount} /></td
										></tr
									>{/each}</tbody
							>
						</table>{/if}
					<div>
						<label class={labelClass} for="paymentMethod">Method</label><select
							class={inputClass}
							id="paymentMethod"
							name="paymentMethod"
							><option value="cash">{PAYMENT_METHOD_LABELS.cash}</option><option value="transfer"
								>{PAYMENT_METHOD_LABELS.transfer}</option
							></select
						>
					</div>
					<button class={primaryButtonClass}>Add payment</button>
				</form>
			</section>{/if}
	{/if}
	<section class={cardClass}>
		<h2 class="mb-4 text-base font-semibold">Payments</h2>
		<table class="min-w-full text-sm">
			<thead class="text-left text-xs uppercase text-slate-500">
				<tr>
					<th class="py-2">Date</th><th>Amount</th><th>Method</th><th>Status</th>
					{#if data.settlement.status !== 'open'}<th>Document</th>{/if}
					{#if data.can.remove}<th>Action</th>{/if}
				</tr>
			</thead>
			<tbody>
				{#each data.payments as p (p.id)}
					<tr>
						<td class="py-2">{p.date}</td>
						<td>{formatMoney(p.amount)}</td>
						<td>{p.method}</td>
						<td>{p.status}</td>
						{#if data.settlement.status !== 'open'}<td>
								{#if p.status === 'confirmed'}<a
										class="text-blue-700 hover:underline"
										href={resolve(`/campaigns/${data.campaign.id}/payments/${p.id}/print`)}
										>Certificate</a
									>{:else}—{/if}
							</td>{/if}
						{#if data.can.remove}<td>
								<form method="POST" action="?/remove" class="flex gap-2">
									<input type="hidden" name="paymentId" value={p.id} /><input
										class={inputClass}
										name="reason"
										aria-label={`Reason required (maximum ${data.reasonMax} characters)`}
										placeholder="Reason required"
									/><button class={secondaryButtonClass}>Remove</button>
								</form>
							</td>{/if}
					</tr>
				{:else}<tr><td colspan="6" class="py-3 text-slate-500">No payments recorded.</td></tr>
				{/each}
			</tbody>
		</table>
	</section>
	{#if data.can.close}<section class={cardClass}>
			<h2 class="text-base font-semibold">Close settlement</h2>
			<p class="mt-2 text-sm">
				Confirming closes this settlement with a grand total of {formatMoney(
					data.totals.totalAmount
				)}.
			</p>
			<form
				method="POST"
				action="?/close"
				class="mt-3"
				onsubmit={(event) => {
					if (!confirm('Close this settlement?')) event.preventDefault();
				}}
			>
				<button class={primaryButtonClass}>Close settlement</button>
			</form>
		</section>{/if}
</div>

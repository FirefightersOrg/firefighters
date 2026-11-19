<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import FieldError from '$lib/components/campaigns/FieldError.svelte';
	import FormAlert from '$lib/components/campaigns/FormAlert.svelte';
	import {
		cardClass,
		inputClass,
		labelClass,
		primaryButtonClass,
		secondaryButtonClass
	} from '$lib/components/campaigns/styles';
	import { formatMoney } from '$lib/domain/money';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const money = (n: number) => formatMoney(n.toFixed(2));

	const ENTRY_TYPE_LABELS: Record<string, string> = {
		commission_generated: 'Commission generated',
		commission_settled: 'Commission settled',
		cash_settled: 'Cash settled',
		transfer_received_by_firefighters: 'Transfer received by Firefighters',
		adjustment_in_favor_of_collector: 'Adjustment in favor of the collector',
		adjustment_in_favor_of_firefighters: 'Adjustment in favor of Firefighters',
		annulment: 'Annulment'
	};

	function source(entry: {
		settlementId: string | null;
		paymentId: string | null;
		entryType: string;
	}) {
		if (entry.settlementId) return 'Settlement';
		if (entry.paymentId) return 'Payment';
		return entry.entryType.startsWith('adjustment') ? 'Manual adjustment' : 'Manual';
	}

	const result = $derived(
		form as {
			form?: string;
			success?: boolean;
			message?: string;
			errors?: Record<string, string[]>;
		} | null
	);
	const errorsFor = (name: string) => (result?.form === name ? (result.errors ?? {}) : {});
</script>

<svelte:head>
	<title>Current account - {data.collector.displayName} - {data.campaign.name} - Firefighters</title
	>
</svelte:head>

<div class="space-y-6">
	<div>
		<nav class="text-sm">
			<a
				href={resolve('/campaigns/[id]/collectors/[collectorId]', {
					id: data.campaign.id,
					collectorId: data.collector.id
				})}
				class="text-blue-700 hover:underline">← {data.collector.displayName}</a
			>
		</nav>
		<h1 class="mt-2 text-2xl font-bold">Current account</h1>
		<p class="mt-1 text-sm text-slate-600">
			Balance: <strong data-testid="ledger-balance" class="tabular-nums"
				>{money(data.balance)}</strong
			>
			<span class="text-slate-500"
				>({data.balance >= 0 ? 'owed to the collector' : 'owed by the collector'}; rebuilt from
				non-annulled entries)</span
			>
		</p>
	</div>

	{#if result?.message}
		<FormAlert kind={result.success ? 'success' : 'error'} message={result.message} />
	{/if}

	<section class={cardClass} aria-labelledby="entries-title">
		<h2 id="entries-title" class="mb-4 text-base font-semibold">Entries</h2>
		{#if data.entries.length === 0}
			<p class="text-sm text-slate-600">No entries yet.</p>
		{:else}
			<div class="-mx-6 overflow-x-auto">
				<table class="min-w-full divide-y divide-slate-200 text-sm">
					<thead>
						<tr class="text-left text-xs font-medium text-slate-500">
							<th scope="col" class="px-6 py-2">Date</th>
							<th scope="col" class="px-3 py-2">Type</th>
							<th scope="col" class="px-3 py-2">Source</th>
							<th scope="col" class="px-3 py-2">Settlement</th>
							<th scope="col" class="px-3 py-2">Payment</th>
							<th scope="col" class="px-3 py-2 text-right">Debit</th>
							<th scope="col" class="px-3 py-2 text-right">Credit</th>
							<th scope="col" class="px-3 py-2 text-right">Balance</th>
							<th scope="col" class="px-3 py-2">Status</th>
							{#if data.can.adjustLedger}
								<th scope="col" class="px-6 py-2"><span class="sr-only">Actions</span></th>
							{/if}
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each data.entries as entry (entry.id)}
							{@const inactive = entry.status !== 'recorded'}
							<tr data-entry={entry.id} class={[inactive && 'text-slate-500']}>
								<td class="px-6 py-2 whitespace-nowrap">{entry.occurredAt.slice(0, 10)}</td>
								<td class={['px-3 py-2', inactive && 'line-through']}
									>{ENTRY_TYPE_LABELS[entry.entryType] ?? entry.entryType}</td
								>
								<td class="px-3 py-2">{source(entry)}</td>
								<td class="px-3 py-2">
									{#if entry.settlementId}
										<!-- eslint-disable svelte/no-navigation-without-resolve -->
										<a
											class="text-blue-700 hover:underline"
											href={`${resolve('/campaigns/[id]', { id: data.campaign.id })}/settlements/${entry.settlementId}`}
											>View</a
										>
										<!-- eslint-enable svelte/no-navigation-without-resolve -->
									{:else}—{/if}
								</td>
								<td class="px-3 py-2">
									{#if entry.paymentId}
										<!-- eslint-disable svelte/no-navigation-without-resolve -->
										<a
											class="text-blue-700 hover:underline"
											href={`${resolve('/campaigns/[id]', { id: data.campaign.id })}/payments/${entry.paymentId}/print`}
											>Certificate</a
										>
										<!-- eslint-enable svelte/no-navigation-without-resolve -->
									{:else}—{/if}
								</td>
								<td class="px-3 py-2 text-right tabular-nums"
									>{entry.direction === 'collector_debit' ? money(entry.amount) : ''}</td
								>
								<td class="px-3 py-2 text-right tabular-nums"
									>{entry.direction === 'collector_credit' ? money(entry.amount) : ''}</td
								>
								<td class="px-3 py-2 text-right tabular-nums">{money(entry.runningBalance)}</td>
								<td class="px-3 py-2">
									{entry.status === 'recorded'
										? 'Recorded'
										: entry.status === 'annulled'
											? 'Annulled'
											: 'Compensated'}
									{#if entry.reason}<p class="max-w-xs text-xs break-words">{entry.reason}</p>{/if}
								</td>
								{#if data.can.adjustLedger}
									<td class="px-6 py-2 text-right">
										{#if entry.status === 'recorded' && !entry.settlementId}
											<form method="POST" action="?/annul" use:enhance class="flex gap-2">
												<input type="hidden" name="entryId" value={entry.id} />
												<label class="sr-only" for="annul-reason-{entry.id}">Annulment reason</label
												>
												<input
													id="annul-reason-{entry.id}"
													name="reason"
													class={inputClass}
													maxlength={data.reasonMax}
													placeholder="Reason"
													required
												/>
												<button class={secondaryButtonClass}>Annul</button>
											</form>
										{/if}
									</td>
								{/if}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>

	{#if data.can.adjustCommission}
		<section class={cardClass} aria-labelledby="commission-adjust-title">
			<h2 id="commission-adjust-title" class="mb-1 text-base font-semibold">
				Manual commission adjustment
			</h2>
			<p class="mb-4 text-xs text-slate-500">
				Recorded as a difference; it never changes the commission rule.
			</p>
			<form method="POST" action="?/adjustCommission" use:enhance class="grid gap-4 sm:grid-cols-3">
				<div>
					<label class={labelClass} for="commission-direction">In favor of</label>
					<select id="commission-direction" name="direction" class={inputClass}>
						<option value="in_favor_of_collector">The collector</option>
						<option value="in_favor_of_firefighters">Firefighters</option>
					</select>
					<FieldError id="commission-direction-error" errors={errorsFor('commission').direction} />
				</div>
				<div>
					<label class={labelClass} for="commission-amount">Amount</label>
					<input
						id="commission-amount"
						name="amount"
						inputmode="decimal"
						class={inputClass}
						required
					/>
					<FieldError id="commission-amount-error" errors={errorsFor('commission').amount} />
				</div>
				<div class="sm:col-span-3">
					<label class={labelClass} for="commission-reason">Reason</label>
					<input
						id="commission-reason"
						name="reason"
						maxlength={data.reasonMax}
						class={inputClass}
						required
					/>
					<FieldError id="commission-reason-error" errors={errorsFor('commission').reason} />
				</div>
				<div><button class={primaryButtonClass}>Record adjustment</button></div>
			</form>
		</section>
	{/if}

	{#if data.can.adjustLedger}
		<section class={cardClass} aria-labelledby="ledger-adjust-title">
			<h2 id="ledger-adjust-title" class="mb-4 text-base font-semibold">
				Current account adjustment
			</h2>
			<form method="POST" action="?/adjustLedger" use:enhance class="grid gap-4 sm:grid-cols-3">
				<div>
					<label class={labelClass} for="ledger-direction">Direction</label>
					<select id="ledger-direction" name="direction" class={inputClass}>
						<option value="collector_credit">Credit (in favor of the collector)</option>
						<option value="collector_debit">Debit (in favor of Firefighters)</option>
					</select>
					<FieldError id="ledger-direction-error" errors={errorsFor('ledger').direction} />
				</div>
				<div>
					<label class={labelClass} for="ledger-amount">Amount</label>
					<input id="ledger-amount" name="amount" inputmode="decimal" class={inputClass} required />
					<FieldError id="ledger-amount-error" errors={errorsFor('ledger').amount} />
				</div>
				<div class="sm:col-span-3">
					<label class={labelClass} for="ledger-reason">Reason</label>
					<input
						id="ledger-reason"
						name="reason"
						maxlength={data.reasonMax}
						class={inputClass}
						required
					/>
					<FieldError id="ledger-reason-error" errors={errorsFor('ledger').reason} />
				</div>
				<div><button class={primaryButtonClass}>Record adjustment</button></div>
			</form>
		</section>
	{/if}
</div>

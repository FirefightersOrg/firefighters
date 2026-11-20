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
	let commissionDelta = $state('0.00');
	let cashRetainedDelta = $state('0.00');
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
						{#if data.can.correctPayment}<td class="space-y-2">
								<details>
									<summary class="cursor-pointer text-blue-700">Correct / annul</summary>
									<div class="mt-2 space-y-3 rounded border p-3">
										<p class="text-xs text-amber-800">
											<strong>Indicative preview:</strong> the database is authoritative. Annulment reverses
											generated commission and, for cash, credits retained commission. Method correction
											posts only the cash-retention difference.
										</p>
										<form method="POST" action="?/annulPayment" class="space-y-2">
											<input type="hidden" name="paymentId" value={p.id} />
											<label class={labelClass} for="annul-reason-{p.id}"
												>Annulment reason (max. {data.reasonMax} Unicode characters)</label
											>
											<textarea class={inputClass} id="annul-reason-{p.id}" name="reason" required
											></textarea>
											<button class={secondaryButtonClass}>Annul payment</button>
										</form>
										<form method="POST" action="?/correctPaymentMethod" class="space-y-2">
											<input type="hidden" name="paymentId" value={p.id} />
											<label class={labelClass} for="method-{p.id}">Correct method</label>
											<select class={inputClass} id="method-{p.id}" name="newMethod"
												><option value="cash">Cash</option><option value="transfer">Transfer</option
												></select
											>
											<label class={labelClass} for="method-reason-{p.id}"
												>Reason (max. {data.reasonMax} Unicode characters)</label
											>
											<textarea class={inputClass} id="method-reason-{p.id}" name="reason" required
											></textarea>
											<button class={secondaryButtonClass}>Confirm method correction</button>
										</form>
										{#if p.method === 'transfer'}<form
												method="POST"
												action="?/reassociateTransfer"
												class="space-y-2"
											>
												<input type="hidden" name="paymentId" value={p.id} />
												<label class={labelClass} for="destination-{p.id}"
													>Destination sale / installment</label
												>
												<select
													class={inputClass}
													id="destination-{p.id}"
													name="installmentId"
													required
												>
													<option value="">Choose…</option>
													{#each data.candidates as candidate (candidate.id)}<option
															value={candidate.id}
															>{candidate.bond} — {candidate.buyer} — installment {candidate.number} —
															remaining {formatMoney(candidate.amount)}</option
														>{/each}
												</select>
												<label class={labelClass} for="destination-sale-{p.id}"
													>Destination sale id</label
												>
												<input
													class={inputClass}
													id="destination-sale-{p.id}"
													name="newSaleId"
													required
												/>
												<label class={labelClass} for="destination-amount-{p.id}"
													>Amount applied</label
												>
												<input
													class={inputClass}
													id="destination-amount-{p.id}"
													name="amountApplied"
													value={p.amount}
													required
												/>
												<label class={labelClass} for="destination-reason-{p.id}"
													>Reason (max. {data.reasonMax} Unicode characters)</label
												>
												<textarea
													class={inputClass}
													id="destination-reason-{p.id}"
													name="reason"
													required></textarea>
												<button class={secondaryButtonClass}>Confirm reassociation</button>
											</form>{/if}
									</div>
								</details>
							</td>{/if}
					</tr>
				{:else}<tr><td colspan="6" class="py-3 text-slate-500">No payments recorded.</td></tr>
				{/each}
			</tbody>
		</table>
	</section>
	{#if data.can.correctSettlement}<section class={cardClass}>
			<h2 class="text-base font-semibold">Correct closed settlement</h2>
			<p class="mt-2 text-sm text-slate-600">
				Creates an immutable correction; the original totals are not edited.
			</p>
			<form method="POST" action="?/correctSettlement" class="mt-3 space-y-3">
				<div class="grid gap-3 sm:grid-cols-2">
					<div>
						<label class={labelClass} for="commissionDelta">Commission delta</label><input
							class={inputClass}
							id="commissionDelta"
							name="commissionDelta"
							bind:value={commissionDelta}
						/>
					</div>
					<div>
						<label class={labelClass} for="cashRetainedDelta">Cash-retained commission delta</label
						><input
							class={inputClass}
							id="cashRetainedDelta"
							name="cashRetainedDelta"
							bind:value={cashRetainedDelta}
						/>
					</div>
				</div>
				<div class="rounded border border-amber-200 bg-amber-50 p-3 text-sm">
					<strong>Indicative ledger preview:</strong> commission {Number(commissionDelta) >= 0
						? 'credit'
						: 'debit'}
					{formatMoney(String(Math.abs(Number(commissionDelta) || 0)))}; cash retained {Number(
						cashRetainedDelta
					) >= 0
						? 'debit'
						: 'credit'}
					{formatMoney(String(Math.abs(Number(cashRetainedDelta) || 0)))}. PostgreSQL numeric
					validation and persisted movements are authoritative.
				</div>
				<label class={labelClass} for="settlement-correction-reason"
					>Reason (max. {data.reasonMax} Unicode characters)</label
				>
				<textarea class={inputClass} id="settlement-correction-reason" name="reason" required
				></textarea>
				<button class={primaryButtonClass}>Record correction</button>
			</form>
		</section>{/if}
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

<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		cardClass,
		inputClass,
		labelClass,
		primaryButtonClass,
		secondaryButtonClass
	} from '$lib/components/campaigns/styles';
	import ExportLinks from '$lib/components/reports/ExportLinks.svelte';
	import {
		formatSignedMoney,
		PAYMENT_METHODS,
		PAYMENT_METHOD_LABELS,
		ROSTER_ELIGIBILITY_FILTERS,
		SETTLEMENT_STATUSES,
		SETTLEMENT_STATUS_LABELS,
		type PaymentMethod,
		type SettlementStatus
	} from '$lib/domain/financial-reports';
	import {
		LEDGER_DIRECTION_LABELS,
		LEDGER_ENTRY_TYPE_LABELS,
		LEDGER_STATUS_LABELS
	} from '$lib/domain/ledger';
	import type { LedgerDirection, LedgerEntryType, LedgerStatus } from '$lib/domain/ledger';
	import { formatInteger, formatMoney } from '$lib/domain/money';
	import {
		PRIZE_STATUSES,
		PRIZE_STATUS_LABELS,
		WINNING_NUMBER_STATUS_LABELS
	} from '$lib/domain/prizes';
	import type { PrizeStatus, WinningNumberStatus } from '$lib/domain/prizes';
	import { drawStatusLabel, drawTypeLabel } from '$lib/domain/report-exports';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const campaign = $derived(data.campaign);
	const filters = $derived(data.filters);
	const exportParams = $derived({
		collector: filters.collectorId,
		method: filters.method,
		settlement: filters.settlementStatus,
		from: filters.from,
		to: filters.to,
		draw: filters.drawId,
		eligibility: filters.eligibility,
		prize: filters.prizeStatus
	});
	const prizeLabel = (s: string) => PRIZE_STATUS_LABELS[s as PrizeStatus] ?? s;

	const th = 'px-3 py-2 text-left font-semibold text-slate-700';
	const thRight = 'px-3 py-2 text-right font-semibold text-slate-700';
	const td = 'px-3 py-2 text-slate-800';
	const tdRight = 'px-3 py-2 text-right tabular-nums text-slate-800';
</script>

<svelte:head><title>Financial reports - {campaign.name} - Firefighters</title></svelte:head>

<div class="space-y-6">
	<div>
		<a
			href={resolve('/campaigns/[id]/reports', { id: campaign.id })}
			class="text-sm text-blue-700 hover:underline">← Operational reports</a
		>
		<h1 class="mt-2 text-2xl font-bold tracking-tight">Financial and draw reports</h1>
		<p class="mt-1 text-sm text-slate-600">
			Read-only views of the current data for {campaign.name}. Draft and annulled payments are not
			counted. Draw rosters are the frozen rosters. Dates are Buenos Aires dates.
		</p>
	</div>

	<form method="GET" class="{cardClass} grid gap-3 sm:grid-cols-3 lg:grid-cols-4 sm:items-end">
		<div>
			<label class={labelClass} for="collector">Collector</label>
			<select class={inputClass} id="collector" name="collector">
				<option value="">All</option>
				{#each data.collectors as c (c.id)}
					<option value={c.id} selected={filters.collectorId === c.id}>{c.displayName}</option>
				{/each}
				{#if filters.collectorId && !data.collectors.some((c) => c.id === filters.collectorId)}
					<option value={filters.collectorId} selected>Selected collector</option>
				{/if}
			</select>
		</div>
		<div>
			<label class={labelClass} for="method">Payment method</label>
			<select class={inputClass} id="method" name="method">
				<option value="">All</option>
				{#each PAYMENT_METHODS as m (m)}
					<option value={m} selected={filters.method === m}
						>{PAYMENT_METHOD_LABELS[m as PaymentMethod]}</option
					>
				{/each}
			</select>
		</div>
		<div>
			<label class={labelClass} for="settlement">Settlement status</label>
			<select class={inputClass} id="settlement" name="settlement">
				<option value="">All</option>
				{#each SETTLEMENT_STATUSES as s (s)}
					<option value={s} selected={filters.settlementStatus === s}
						>{SETTLEMENT_STATUS_LABELS[s as SettlementStatus]}</option
					>
				{/each}
			</select>
		</div>
		<div>
			<label class={labelClass} for="from">From (payments, settlements, account)</label>
			<input class={inputClass} id="from" name="from" type="date" value={filters.from ?? ''} />
		</div>
		<div>
			<label class={labelClass} for="to">To</label>
			<input class={inputClass} id="to" name="to" type="date" value={filters.to ?? ''} />
		</div>
		<div>
			<label class={labelClass} for="draw">Draw (roster and prizes)</label>
			<select class={inputClass} id="draw" name="draw">
				<option value="">All</option>
				{#each data.draws as d (d.drawId)}
					<option value={d.drawId} selected={filters.drawId === d.drawId}>{d.drawName}</option>
				{/each}
			</select>
		</div>
		<div>
			<label class={labelClass} for="eligibility">Roster numbers</label>
			<select class={inputClass} id="eligibility" name="eligibility">
				<option value="">Eligible and ineligible</option>
				{#each ROSTER_ELIGIBILITY_FILTERS as e (e)}
					<option value={e} selected={filters.eligibility === e}
						>{e === 'eligible' ? 'Eligible only' : 'Ineligible only'}</option
					>
				{/each}
			</select>
		</div>
		<div>
			<label class={labelClass} for="prize">Prize status</label>
			<select class={inputClass} id="prize" name="prize">
				<option value="">All</option>
				{#each PRIZE_STATUSES as s (s)}
					<option value={s} selected={filters.prizeStatus === s}>{PRIZE_STATUS_LABELS[s]}</option>
				{/each}
			</select>
		</div>
		<div class="flex gap-2">
			<button type="submit" class={primaryButtonClass}>Apply</button>
			<a
				href={resolve('/campaigns/[id]/reports/financial', { id: campaign.id })}
				class={secondaryButtonClass}>Clear</a
			>
		</div>
	</form>

	<section class={cardClass} aria-labelledby="payments-title">
		<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
			<h2 id="payments-title" class="text-base font-semibold">Payments by date and method</h2>
			<ExportLinks
				campaignId={campaign.id}
				report="payments-by-date"
				params={exportParams}
				show={data.canExport}
			/>
		</div>
		{#if data.payments.days.length === 0}
			<p class="text-sm text-slate-500">No payments match the filters.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="min-w-full divide-y divide-slate-200 text-sm">
					<thead>
						<tr>
							<th class={th}>Date</th>
							<th class={thRight}>Cash</th>
							<th class={thRight}>Transfer</th>
							<th class={thRight}>Payments</th>
							<th class={thRight}>Total</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each data.payments.days as d (d.paymentDate)}
							<tr>
								<td class={td}>{d.paymentDate}</td>
								<td class={tdRight}>{formatMoney(d.cash)}</td>
								<td class={tdRight}>{formatMoney(d.transfer)}</td>
								<td class={tdRight}>{formatInteger(d.count)}</td>
								<td class={tdRight}>{formatMoney(d.total)}</td>
							</tr>
						{/each}
					</tbody>
					<tfoot>
						<tr class="font-semibold">
							<td class={td}>Total</td>
							<td class={tdRight}>{formatMoney(data.payments.totals.cash)}</td>
							<td class={tdRight}>{formatMoney(data.payments.totals.transfer)}</td>
							<td class={tdRight}>{formatInteger(data.payments.totals.count)}</td>
							<td class={tdRight}>{formatMoney(data.payments.totals.total)}</td>
						</tr>
					</tfoot>
				</table>
			</div>
		{/if}
	</section>

	<section class={cardClass} aria-labelledby="settlements-title">
		<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
			<h2 id="settlements-title" class="text-base font-semibold">Settlements by collector</h2>
			<ExportLinks
				campaignId={campaign.id}
				report="settlements-by-collector"
				params={exportParams}
				show={data.canExport}
			/>
		</div>
		{#if data.settlements.rows.length === 0}
			<p class="text-sm text-slate-500">No settlements match the filters.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="min-w-full divide-y divide-slate-200 text-sm">
					<thead>
						<tr>
							<th class={th}>Collector</th>
							<th class={th}>Status</th>
							<th class={thRight}>Settlements</th>
							<th class={thRight}>Cash</th>
							<th class={thRight}>Transfer</th>
							<th class={thRight}>Total</th>
							<th class={thRight}>Commission</th>
							<th class={thRight}>Commission paid</th>
							<th class={thRight}>Net to firefighters</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each data.settlements.rows as r (r.collectorId + r.status)}
							<tr>
								<td class={td}>{r.collectorName}</td>
								<td class={td}
									>{SETTLEMENT_STATUS_LABELS[r.status as SettlementStatus] ?? r.status}</td
								>
								<td class={tdRight}>{formatInteger(r.settlementCount)}</td>
								<td class={tdRight}>{formatMoney(r.totalCash)}</td>
								<td class={tdRight}>{formatMoney(r.totalTransfer)}</td>
								<td class={tdRight}>{formatMoney(r.totalAmount)}</td>
								<td class={tdRight}>{formatMoney(r.commissionAmount)}</td>
								<td class={tdRight}>{formatMoney(r.commissionPaidAmount)}</td>
								<td class={tdRight}>{formatMoney(r.netToFirefighters)}</td>
							</tr>
						{/each}
					</tbody>
					<tfoot>
						<tr class="font-semibold">
							<td class={td} colspan="2">Total</td>
							<td class={tdRight}>{formatInteger(data.settlements.totals.settlementCount)}</td>
							<td class={tdRight}>{formatMoney(data.settlements.totals.totalCash)}</td>
							<td class={tdRight}>{formatMoney(data.settlements.totals.totalTransfer)}</td>
							<td class={tdRight}>{formatMoney(data.settlements.totals.totalAmount)}</td>
							<td class={tdRight}>{formatMoney(data.settlements.totals.commissionAmount)}</td>
							<td class={tdRight}>{formatMoney(data.settlements.totals.commissionPaidAmount)}</td>
							<td class={tdRight}>{formatMoney(data.settlements.totals.netToFirefighters)}</td>
						</tr>
					</tfoot>
				</table>
			</div>
		{/if}
	</section>

	<section class={cardClass} aria-labelledby="accounts-title">
		<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
			<h2 id="accounts-title" class="text-base font-semibold">Collector current accounts</h2>
			<ExportLinks
				campaignId={campaign.id}
				report="collector-accounts"
				params={exportParams}
				show={data.canExport}
			/>
		</div>
		{#if data.accounts.rows.length === 0}
			<p class="text-sm text-slate-500">No account entries match the filters.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="min-w-full divide-y divide-slate-200 text-sm">
					<thead>
						<tr>
							<th class={th}>Collector</th>
							<th class={thRight}>Entries</th>
							<th class={thRight}>Credits</th>
							<th class={thRight}>Debits</th>
							<th class={thRight}>Balance</th>
							<th class={th}>Last entry</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each data.accounts.rows as r (r.collectorId)}
							<tr>
								<td class={td}>
									<a
										class="text-blue-700 hover:underline"
										href="{resolve('/campaigns/[id]/reports/financial', {
											id: campaign.id
										})}?collector={r.collectorId}">{r.collectorName}</a
									>
								</td>
								<td class={tdRight}>{formatInteger(r.entryCount)}</td>
								<td class={tdRight}>{formatMoney(r.creditTotal)}</td>
								<td class={tdRight}>{formatMoney(r.debitTotal)}</td>
								<td class={tdRight}>{formatSignedMoney(r.balance)}</td>
								<td class={td}>{r.lastEntryOn ?? ''}</td>
							</tr>
						{/each}
					</tbody>
					<tfoot>
						<tr class="font-semibold">
							<td class={td}>Total</td>
							<td class={tdRight}>{formatInteger(data.accounts.totals.entryCount)}</td>
							<td class={tdRight}>{formatMoney(data.accounts.totals.creditTotal)}</td>
							<td class={tdRight}>{formatMoney(data.accounts.totals.debitTotal)}</td>
							<td class={tdRight}>{formatSignedMoney(data.accounts.totals.balance)}</td>
							<td class={td}></td>
						</tr>
					</tfoot>
				</table>
			</div>
		{/if}

		<div class="mt-5 border-t border-slate-100 pt-4">
			<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
				<h3 class="text-sm font-semibold">Account detail</h3>
				{#if data.ledger}
					<ExportLinks
						campaignId={campaign.id}
						report="collector-ledger"
						params={exportParams}
						show={data.canExport}
					/>
				{/if}
			</div>
			{#if !data.ledger}
				<p class="text-sm text-slate-500">Choose a collector to see the account detail.</p>
			{:else if data.ledger.length === 0}
				<p class="text-sm text-slate-500">No account entries in this period.</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="min-w-full divide-y divide-slate-200 text-sm">
						<thead>
							<tr>
								<th class={th}>Date</th>
								<th class={th}>Type</th>
								<th class={th}>Direction</th>
								<th class={thRight}>Amount</th>
								<th class={th}>Status</th>
								<th class={thRight}>Settlement</th>
								<th class={th}>Reason</th>
								<th class={thRight}>Balance</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-slate-100">
							{#each data.ledger as e (e.entryId)}
								<tr>
									<td class={td}>{e.occurredOn} {e.occurredTime}</td>
									<td class={td}
										>{LEDGER_ENTRY_TYPE_LABELS[e.entryType as LedgerEntryType] ?? e.entryType}</td
									>
									<td class={td}
										>{LEDGER_DIRECTION_LABELS[e.direction as LedgerDirection] ?? e.direction}</td
									>
									<td class={tdRight}>{formatMoney(e.amount)}</td>
									<td class={td}>{LEDGER_STATUS_LABELS[e.status as LedgerStatus] ?? e.status}</td>
									<td class={tdRight}>{e.settlementNumber ?? ''}</td>
									<td class={td}>{e.reason ?? ''}</td>
									<td class={tdRight}>{formatSignedMoney(e.runningBalance)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	</section>

	<section class={cardClass} aria-labelledby="rosters-title">
		<h2 id="rosters-title" class="mb-3 text-base font-semibold">Draw rosters</h2>
		{#if data.draws.length === 0}
			<p class="text-sm text-slate-500">This campaign has no draws.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="min-w-full divide-y divide-slate-200 text-sm">
					<thead>
						<tr>
							<th class={th}>Draw</th>
							<th class={th}>Type</th>
							<th class={th}>Date</th>
							<th class={th}>Status</th>
							<th class={th}>Frozen roster</th>
							<th class={thRight}>Eligible</th>
							<th class={thRight}>Ineligible</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each data.draws as d (d.drawId)}
							<tr>
								<td class={td}>
									<a
										class="text-blue-700 hover:underline"
										href="{resolve('/campaigns/[id]/reports/financial', {
											id: campaign.id
										})}?draw={d.drawId}">{d.drawName}</a
									>
								</td>
								<td class={td}>{drawTypeLabel(d.drawType)}</td>
								<td class={td}>{d.drawDate}</td>
								<td class={td}>{drawStatusLabel(d.drawStatus)}</td>
								<td class={td}>{d.rosterStatus ? 'Frozen' : 'Not frozen'}</td>
								<td class={tdRight}>{formatInteger(d.eligibleCount)}</td>
								<td class={tdRight}>{formatInteger(d.ineligibleCount)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		<div class="mt-5 border-t border-slate-100 pt-4">
			<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
				<h3 class="text-sm font-semibold">
					Roster numbers{data.selectedDraw ? ` - ${data.selectedDraw.drawName}` : ''}
				</h3>
				{#if data.roster}
					<ExportLinks
						campaignId={campaign.id}
						report="draw-roster"
						params={exportParams}
						show={data.canExport}
					/>
				{/if}
			</div>
			{#if !data.roster}
				<p class="text-sm text-slate-500">Choose a draw to see its roster numbers.</p>
			{:else if data.roster.length === 0}
				<p class="text-sm text-slate-500">
					No roster numbers match (the roster may not be frozen).
				</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="min-w-full divide-y divide-slate-200 text-sm">
						<thead>
							<tr>
								<th class={thRight}>Number</th>
								<th class={th}>Eligible</th>
								<th class={th}>Reason</th>
								<th class={th}>Buyer</th>
								<th class={th}>Collector</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-slate-100">
							{#each data.roster as e (e.numberValue)}
								<tr>
									<td class={tdRight}>{e.numberValue}</td>
									<td class={td}>{e.eligible ? 'Yes' : 'No'}</td>
									<td class={td}>{e.ineligibilityReason ?? ''}</td>
									<td class={td}>{e.buyerName ?? ''}</td>
									<td class={td}>{e.collectorName ?? ''}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				{#if data.rosterTruncated}
					<p class="mt-2 text-sm text-slate-500">
						Showing the first {formatInteger(data.roster.length)} numbers. The export has all of them.
					</p>
				{/if}
			{/if}
		</div>
	</section>

	<section class={cardClass} aria-labelledby="prizes-title">
		<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
			<h2 id="prizes-title" class="text-base font-semibold">Winners and prizes</h2>
			<ExportLinks
				campaignId={campaign.id}
				report="prizes"
				params={exportParams}
				show={data.canExport}
			/>
		</div>
		{#if data.prizes.rows.length === 0}
			<p class="text-sm text-slate-500">No prizes match the filters.</p>
		{:else}
			<ul class="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-700">
				{#each PRIZE_STATUSES as s (s)}
					{#if data.prizes.counts[s]}
						<li>
							{PRIZE_STATUS_LABELS[s]}: <strong>{formatInteger(data.prizes.counts[s])}</strong>
						</li>
					{/if}
				{/each}
			</ul>
			<div class="overflow-x-auto">
				<table class="min-w-full divide-y divide-slate-200 text-sm">
					<thead>
						<tr>
							<th class={th}>Draw</th>
							<th class={thRight}>Position</th>
							<th class={th}>Prize</th>
							<th class={th}>Status</th>
							<th class={thRight}>Number</th>
							<th class={th}>Result</th>
							<th class={th}>Buyer</th>
							<th class={th}>Collector</th>
							<th class={th}>Awarded</th>
							<th class={th}>Delivered</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each data.prizes.rows as p (p.prizeId)}
							<tr>
								<td class={td}>{p.drawName}</td>
								<td class={tdRight}>{p.position}</td>
								<td class={td}>{p.prizeName}</td>
								<td class={td}>{prizeLabel(p.prizeStatus)}</td>
								<td class={tdRight}>{p.winningNumber ?? ''}</td>
								<td class={td}
									>{p.resultStatus
										? (WINNING_NUMBER_STATUS_LABELS[p.resultStatus as WinningNumberStatus] ??
											p.resultStatus)
										: ''}</td
								>
								<td class={td}>{p.buyerName ?? ''}</td>
								<td class={td}>{p.collectorName ?? ''}</td>
								<td class={td}>{p.awardedOn ?? ''}</td>
								<td class={td}>{p.deliveredOn ?? ''}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</div>
